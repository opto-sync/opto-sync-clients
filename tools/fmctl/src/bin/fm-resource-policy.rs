use std::env;
use std::error::Error;
use std::io::{self, Read, Write};
use std::process::ExitCode;

use serde::Deserialize;

#[allow(dead_code)]
#[path = "../resource.rs"]
mod resource;

use resource::{ResourceProfile, ResourceRequest};

const MAX_REQUEST_BYTES: u64 = 1024 * 1024;

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("fm-resource-policy: {error}");
            ExitCode::from(2)
        }
    }
}

fn run() -> Result<(), Box<dyn Error>> {
    let mut arguments = env::args().skip(1);
    let command = arguments.next().ok_or_else(usage_error)?;
    let profile = parse_profile(&arguments.next().ok_or_else(usage_error)?)?;
    if arguments.next().is_some() {
        return Err(usage_error().into());
    }

    match command.as_str() {
        "profile" => write_json(&profile)?,
        "resolve" => {
            let request = read_request(io::stdin().lock())?;
            let effective = profile.resolve(request)?;
            write_json(&effective)?;
        }
        _ => return Err(usage_error().into()),
    }
    Ok(())
}

fn parse_profile(value: &str) -> Result<ResourceProfile, io::Error> {
    match value {
        "local" => Ok(ResourceProfile::local_v1()),
        "ci" => Ok(ResourceProfile::ci_v1()),
        "service" => Ok(ResourceProfile::service_v1()),
        _ => Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("unknown resource profile {value:?}"),
        )),
    }
}

fn read_request(mut input: impl Read) -> Result<ResourceRequest, Box<dyn Error>> {
    let mut bytes = Vec::new();
    input
        .by_ref()
        .take(MAX_REQUEST_BYTES + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_REQUEST_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("resource request exceeds the {MAX_REQUEST_BYTES}-byte limit"),
        )
        .into());
    }
    let mut deserializer = serde_json::Deserializer::from_slice(&bytes);
    let request = ResourceRequest::deserialize(&mut deserializer)?;
    deserializer.end()?;
    Ok(request)
}

fn write_json(value: &impl serde::Serialize) -> Result<(), Box<dyn Error>> {
    serde_json::to_writer(&mut io::stdout(), value)?;
    io::stdout().write_all(b"\n")?;
    Ok(())
}

fn usage_error() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        "usage: fm-resource-policy <profile|resolve> <local|ci|service>",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use resource::ResourceProfileName;

    #[test]
    fn parses_every_named_profile() {
        assert_eq!(
            parse_profile("local").expect("local").name,
            ResourceProfileName::Local
        );
        assert_eq!(
            parse_profile("ci").expect("ci").name,
            ResourceProfileName::Ci
        );
        assert_eq!(
            parse_profile("service").expect("service").name,
            ResourceProfileName::Service
        );
        assert!(parse_profile("unbounded").is_err());
    }

    #[test]
    fn request_reader_requires_one_complete_json_value() {
        let request = read_request(
            br#"{"timeout_seconds":null,"max_output_bytes":null,"simulation_max_samples":null,"simulation_max_steps":null,"verification_max_steps":null,"trace_count":null,"trace_max_steps":null,"trace_max_samples":null}"#
                .as_slice(),
        )
        .expect("request");
        assert_eq!(request, ResourceRequest::absent());
        assert!(read_request(br#"{} trailing"#.as_slice()).is_err());
    }

    #[test]
    fn request_reader_is_allocation_bounded() {
        let oversized = vec![b' '; usize::try_from(MAX_REQUEST_BYTES).unwrap() + 1];
        let error = read_request(oversized.as_slice()).expect_err("oversized request");
        assert!(error.to_string().contains("exceeds"));
    }
}
