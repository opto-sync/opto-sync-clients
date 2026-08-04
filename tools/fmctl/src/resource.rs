use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const RESOURCE_POLICY_SCHEMA_VERSION: u32 = 1;
pub const RESOURCE_POLICY_VERSION: &str = "fm.resources.v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceProfileName {
    Local,
    Ci,
    Service,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OverageBehavior {
    Reject,
    Clamp,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceValues {
    pub timeout_seconds: u64,
    pub max_output_bytes: u64,
    pub simulation_max_samples: u64,
    pub simulation_max_steps: u64,
    pub verification_max_steps: u64,
    pub trace_count: u64,
    pub trace_max_steps: u64,
    pub trace_max_samples: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceCeilings {
    pub scalar: ResourceValues,
    pub max_simulation_work: u64,
    pub max_trace_work: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceRequest {
    pub timeout_seconds: Option<u64>,
    pub max_output_bytes: Option<u64>,
    pub simulation_max_samples: Option<u64>,
    pub simulation_max_steps: Option<u64>,
    pub verification_max_steps: Option<u64>,
    pub trace_count: Option<u64>,
    pub trace_max_steps: Option<u64>,
    pub trace_max_samples: Option<u64>,
}

impl ResourceRequest {
    pub const fn absent() -> Self {
        Self {
            timeout_seconds: None,
            max_output_bytes: None,
            simulation_max_samples: None,
            simulation_max_steps: None,
            verification_max_steps: None,
            trace_count: None,
            trace_max_steps: None,
            trace_max_samples: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResourceProfile {
    pub schema_version: u32,
    pub policy_version: String,
    pub name: ResourceProfileName,
    pub overage_behavior: OverageBehavior,
    pub defaults: ResourceValues,
    pub maximum: ResourceCeilings,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EffectiveResourceValues {
    pub scalar: ResourceValues,
    pub simulation_work: u64,
    pub trace_count_work: u64,
    pub trace_sample_work: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EffectiveResourcePolicy {
    pub schema_version: u32,
    pub policy_version: String,
    pub profile: ResourceProfileName,
    pub overage_behavior: OverageBehavior,
    pub requested: ResourceRequest,
    pub policy_defaults: ResourceValues,
    pub policy_maximum: ResourceCeilings,
    pub effective: EffectiveResourceValues,
    pub inherited_fields: Vec<String>,
    pub clamped_fields: Vec<String>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ResourcePolicyError {
    #[error("unsupported resource policy schema version {actual}")]
    UnsupportedSchema { actual: u32 },
    #[error("unsupported resource policy version {actual:?}")]
    UnsupportedPolicyVersion { actual: String },
    #[error("resource profile {profile:?} has invalid zero field {field}")]
    InvalidProfile {
        profile: ResourceProfileName,
        field: &'static str,
    },
    #[error("resource profile {profile:?} default {field}={default} exceeds maximum {maximum}")]
    DefaultOverMaximum {
        profile: ResourceProfileName,
        field: &'static str,
        default: u64,
        maximum: u64,
    },
    #[error("resource request field {field} must be greater than zero")]
    ZeroRequest { field: &'static str },
    #[error("resource request field {field}={requested} exceeds {profile:?} maximum {maximum}")]
    OverPolicy {
        profile: ResourceProfileName,
        field: &'static str,
        requested: u64,
        maximum: u64,
    },
    #[error("resource work field {field} overflowed u64")]
    WorkOverflow { field: &'static str },
    #[error("resource work field {field}={actual} exceeds {profile:?} maximum {maximum}")]
    WorkOverPolicy {
        profile: ResourceProfileName,
        field: &'static str,
        actual: u64,
        maximum: u64,
    },
}

impl ResourceProfile {
    pub fn local_v1() -> Self {
        Self {
            schema_version: RESOURCE_POLICY_SCHEMA_VERSION,
            policy_version: RESOURCE_POLICY_VERSION.to_owned(),
            name: ResourceProfileName::Local,
            overage_behavior: OverageBehavior::Reject,
            defaults: ResourceValues {
                timeout_seconds: 120,
                max_output_bytes: 4 * 1024 * 1024,
                simulation_max_samples: 10_000,
                simulation_max_steps: 40,
                verification_max_steps: 100,
                trace_count: 8,
                trace_max_steps: 30,
                trace_max_samples: 500,
            },
            maximum: ResourceCeilings {
                scalar: ResourceValues {
                    timeout_seconds: 21_600,
                    max_output_bytes: 64 * 1024 * 1024,
                    simulation_max_samples: 1_000_000,
                    simulation_max_steps: 100_000,
                    verification_max_steps: 100_000,
                    trace_count: 10_000,
                    trace_max_steps: 100_000,
                    trace_max_samples: 1_000_000,
                },
                max_simulation_work: 100_000_000,
                max_trace_work: 100_000_000,
            },
        }
    }

    pub fn ci_v1() -> Self {
        Self {
            schema_version: RESOURCE_POLICY_SCHEMA_VERSION,
            policy_version: RESOURCE_POLICY_VERSION.to_owned(),
            name: ResourceProfileName::Ci,
            overage_behavior: OverageBehavior::Clamp,
            defaults: ResourceValues {
                timeout_seconds: 600,
                max_output_bytes: 8 * 1024 * 1024,
                simulation_max_samples: 500,
                simulation_max_steps: 10_000,
                verification_max_steps: 10_000,
                trace_count: 100,
                trace_max_steps: 10_000,
                trace_max_samples: 500,
            },
            maximum: ResourceCeilings {
                scalar: ResourceValues {
                    timeout_seconds: 7_200,
                    max_output_bytes: 32 * 1024 * 1024,
                    simulation_max_samples: 1_000,
                    simulation_max_steps: 25_000,
                    verification_max_steps: 25_000,
                    trace_count: 1_000,
                    trace_max_steps: 25_000,
                    trace_max_samples: 1_000,
                },
                max_simulation_work: 25_000_000,
                max_trace_work: 25_000_000,
            },
        }
    }

    pub fn service_v1() -> Self {
        Self {
            schema_version: RESOURCE_POLICY_SCHEMA_VERSION,
            policy_version: RESOURCE_POLICY_VERSION.to_owned(),
            name: ResourceProfileName::Service,
            overage_behavior: OverageBehavior::Clamp,
            defaults: ResourceValues {
                timeout_seconds: 300,
                max_output_bytes: 2 * 1024 * 1024,
                simulation_max_samples: 100,
                simulation_max_steps: 5_000,
                verification_max_steps: 5_000,
                trace_count: 50,
                trace_max_steps: 5_000,
                trace_max_samples: 100,
            },
            maximum: ResourceCeilings {
                scalar: ResourceValues {
                    timeout_seconds: 900,
                    max_output_bytes: 8 * 1024 * 1024,
                    simulation_max_samples: 500,
                    simulation_max_steps: 10_000,
                    verification_max_steps: 10_000,
                    trace_count: 500,
                    trace_max_steps: 10_000,
                    trace_max_samples: 500,
                },
                max_simulation_work: 5_000_000,
                max_trace_work: 5_000_000,
            },
        }
    }

    pub fn resolve(
        &self,
        request: ResourceRequest,
    ) -> Result<EffectiveResourcePolicy, ResourcePolicyError> {
        self.validate()?;
        let mut inherited_fields = Vec::new();
        let mut clamped_fields = Vec::new();

        let timeout_seconds = self.resolve_field(
            "timeout_seconds",
            request.timeout_seconds,
            self.defaults.timeout_seconds,
            self.maximum.scalar.timeout_seconds,
            &mut inherited_fields,
            &mut clamped_fields,
        )?;
        let max_output_bytes = self.resolve_field(
            "max_output_bytes",
            request.max_output_bytes,
            self.defaults.max_output_bytes,
            self.maximum.scalar.max_output_bytes,
            &mut inherited_fields,
            &mut clamped_fields,
        )?;
        let simulation_max_samples = self.resolve_field(
            "simulation_max_samples",
            request.simulation_max_samples,
            self.defaults.simulation_max_samples,
            self.maximum.scalar.simulation_max_samples,
            &mut inherited_fields,
            &mut clamped_fields,
        )?;
        let simulation_max_steps = self.resolve_field(
            "simulation_max_steps",
            request.simulation_max_steps,
            self.defaults.simulation_max_steps,
            self.maximum.scalar.simulation_max_steps,
            &mut inherited_fields,
            &mut clamped_fields,
        )?;
        let verification_max_steps = self.resolve_field(
            "verification_max_steps",
            request.verification_max_steps,
            self.defaults.verification_max_steps,
            self.maximum.scalar.verification_max_steps,
            &mut inherited_fields,
            &mut clamped_fields,
        )?;
        let trace_count = self.resolve_field(
            "trace_count",
            request.trace_count,
            self.defaults.trace_count,
            self.maximum.scalar.trace_count,
            &mut inherited_fields,
            &mut clamped_fields,
        )?;
        let trace_max_steps = self.resolve_field(
            "trace_max_steps",
            request.trace_max_steps,
            self.defaults.trace_max_steps,
            self.maximum.scalar.trace_max_steps,
            &mut inherited_fields,
            &mut clamped_fields,
        )?;
        let trace_max_samples = self.resolve_field(
            "trace_max_samples",
            request.trace_max_samples,
            self.defaults.trace_max_samples,
            self.maximum.scalar.trace_max_samples,
            &mut inherited_fields,
            &mut clamped_fields,
        )?;

        let simulation_work = checked_work(
            self.name,
            "simulation_max_samples * simulation_max_steps",
            simulation_max_samples,
            simulation_max_steps,
            self.maximum.max_simulation_work,
        )?;
        let trace_count_work = checked_work(
            self.name,
            "trace_count * trace_max_steps",
            trace_count,
            trace_max_steps,
            self.maximum.max_trace_work,
        )?;
        let trace_sample_work = checked_work(
            self.name,
            "trace_max_samples * trace_max_steps",
            trace_max_samples,
            trace_max_steps,
            self.maximum.max_trace_work,
        )?;

        Ok(EffectiveResourcePolicy {
            schema_version: self.schema_version,
            policy_version: self.policy_version.clone(),
            profile: self.name,
            overage_behavior: self.overage_behavior,
            requested: request,
            policy_defaults: self.defaults.clone(),
            policy_maximum: self.maximum.clone(),
            effective: EffectiveResourceValues {
                scalar: ResourceValues {
                    timeout_seconds,
                    max_output_bytes,
                    simulation_max_samples,
                    simulation_max_steps,
                    verification_max_steps,
                    trace_count,
                    trace_max_steps,
                    trace_max_samples,
                },
                simulation_work,
                trace_count_work,
                trace_sample_work,
            },
            inherited_fields,
            clamped_fields,
        })
    }

    fn resolve_field(
        &self,
        field: &'static str,
        requested: Option<u64>,
        default: u64,
        maximum: u64,
        inherited_fields: &mut Vec<String>,
        clamped_fields: &mut Vec<String>,
    ) -> Result<u64, ResourcePolicyError> {
        let Some(requested) = requested else {
            inherited_fields.push(field.to_owned());
            return Ok(default);
        };
        if requested == 0 {
            return Err(ResourcePolicyError::ZeroRequest { field });
        }
        if requested <= maximum {
            return Ok(requested);
        }
        match self.overage_behavior {
            OverageBehavior::Reject => Err(ResourcePolicyError::OverPolicy {
                profile: self.name,
                field,
                requested,
                maximum,
            }),
            OverageBehavior::Clamp => {
                clamped_fields.push(field.to_owned());
                Ok(maximum)
            }
        }
    }

    fn validate(&self) -> Result<(), ResourcePolicyError> {
        if self.schema_version != RESOURCE_POLICY_SCHEMA_VERSION {
            return Err(ResourcePolicyError::UnsupportedSchema {
                actual: self.schema_version,
            });
        }
        if self.policy_version != RESOURCE_POLICY_VERSION {
            return Err(ResourcePolicyError::UnsupportedPolicyVersion {
                actual: self.policy_version.clone(),
            });
        }
        for ((field, default), (_, maximum)) in resource_fields(&self.defaults)
            .into_iter()
            .zip(resource_fields(&self.maximum.scalar))
        {
            if default == 0 {
                return Err(ResourcePolicyError::InvalidProfile {
                    profile: self.name,
                    field,
                });
            }
            if maximum == 0 {
                return Err(ResourcePolicyError::InvalidProfile {
                    profile: self.name,
                    field,
                });
            }
            if default > maximum {
                return Err(ResourcePolicyError::DefaultOverMaximum {
                    profile: self.name,
                    field,
                    default,
                    maximum,
                });
            }
        }
        if self.maximum.max_simulation_work == 0 {
            return Err(ResourcePolicyError::InvalidProfile {
                profile: self.name,
                field: "max_simulation_work",
            });
        }
        if self.maximum.max_trace_work == 0 {
            return Err(ResourcePolicyError::InvalidProfile {
                profile: self.name,
                field: "max_trace_work",
            });
        }
        checked_work(
            self.name,
            "default simulation work",
            self.defaults.simulation_max_samples,
            self.defaults.simulation_max_steps,
            self.maximum.max_simulation_work,
        )?;
        checked_work(
            self.name,
            "default trace count work",
            self.defaults.trace_count,
            self.defaults.trace_max_steps,
            self.maximum.max_trace_work,
        )?;
        checked_work(
            self.name,
            "default trace sample work",
            self.defaults.trace_max_samples,
            self.defaults.trace_max_steps,
            self.maximum.max_trace_work,
        )?;
        Ok(())
    }
}

fn resource_fields(values: &ResourceValues) -> [(&'static str, u64); 8] {
    [
        ("timeout_seconds", values.timeout_seconds),
        ("max_output_bytes", values.max_output_bytes),
        ("simulation_max_samples", values.simulation_max_samples),
        ("simulation_max_steps", values.simulation_max_steps),
        ("verification_max_steps", values.verification_max_steps),
        ("trace_count", values.trace_count),
        ("trace_max_steps", values.trace_max_steps),
        ("trace_max_samples", values.trace_max_samples),
    ]
}

fn checked_work(
    profile: ResourceProfileName,
    field: &'static str,
    left: u64,
    right: u64,
    maximum: u64,
) -> Result<u64, ResourcePolicyError> {
    let actual = left
        .checked_mul(right)
        .ok_or(ResourcePolicyError::WorkOverflow { field })?;
    if actual > maximum {
        Err(ResourcePolicyError::WorkOverPolicy {
            profile,
            field,
            actual,
            maximum,
        })
    } else {
        Ok(actual)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request_from(values: &ResourceValues) -> ResourceRequest {
        ResourceRequest {
            timeout_seconds: Some(values.timeout_seconds),
            max_output_bytes: Some(values.max_output_bytes),
            simulation_max_samples: Some(values.simulation_max_samples),
            simulation_max_steps: Some(values.simulation_max_steps),
            verification_max_steps: Some(values.verification_max_steps),
            trace_count: Some(values.trace_count),
            trace_max_steps: Some(values.trace_max_steps),
            trace_max_samples: Some(values.trace_max_samples),
        }
    }

    #[test]
    fn absent_requests_inherit_named_profile_defaults() {
        let profile = ResourceProfile::service_v1();
        let resolved = profile
            .resolve(ResourceRequest::absent())
            .expect("service defaults");
        assert_eq!(resolved.effective.scalar, profile.defaults);
        assert_eq!(
            resolved.inherited_fields,
            [
                "timeout_seconds",
                "max_output_bytes",
                "simulation_max_samples",
                "simulation_max_steps",
                "verification_max_steps",
                "trace_count",
                "trace_max_steps",
                "trace_max_samples",
            ]
        );
        assert!(resolved.clamped_fields.is_empty());
    }

    #[test]
    fn local_profile_rejects_overages() {
        let profile = ResourceProfile::local_v1();
        let mut request = request_from(&profile.defaults);
        request.timeout_seconds = Some(profile.maximum.scalar.timeout_seconds + 1);
        assert_eq!(
            profile.resolve(request),
            Err(ResourcePolicyError::OverPolicy {
                profile: ResourceProfileName::Local,
                field: "timeout_seconds",
                requested: 21_601,
                maximum: 21_600,
            })
        );
    }

    #[test]
    fn service_profile_clamps_scalars_and_records_them_in_field_order() {
        let profile = ResourceProfile::service_v1();
        let mut request = request_from(&profile.defaults);
        request.timeout_seconds = Some(profile.maximum.scalar.timeout_seconds + 1);
        request.max_output_bytes = Some(profile.maximum.scalar.max_output_bytes + 1);
        let resolved = profile.resolve(request).expect("clamped service request");
        assert_eq!(
            resolved.clamped_fields,
            ["timeout_seconds", "max_output_bytes"]
        );
        assert_eq!(
            resolved.effective.scalar.timeout_seconds,
            profile.maximum.scalar.timeout_seconds
        );
        assert_eq!(
            resolved.effective.scalar.max_output_bytes,
            profile.maximum.scalar.max_output_bytes
        );
    }

    #[test]
    fn coupled_work_overages_are_rejected_even_for_clamping_profiles() {
        let mut profile = ResourceProfile::service_v1();
        profile.maximum.max_simulation_work -= 1;
        let mut request = request_from(&profile.defaults);
        request.simulation_max_samples = Some(profile.maximum.scalar.simulation_max_samples);
        request.simulation_max_steps = Some(profile.maximum.scalar.simulation_max_steps);
        assert_eq!(
            profile.resolve(request),
            Err(ResourcePolicyError::WorkOverPolicy {
                profile: ResourceProfileName::Service,
                field: "simulation_max_samples * simulation_max_steps",
                actual: 5_000_000,
                maximum: 4_999_999,
            })
        );
    }

    #[test]
    fn invalid_profile_identity_and_defaults_fail_closed() {
        let mut profile = ResourceProfile::local_v1();
        profile.schema_version += 1;
        assert_eq!(
            profile.resolve(ResourceRequest::absent()),
            Err(ResourcePolicyError::UnsupportedSchema { actual: 2 })
        );

        let mut profile = ResourceProfile::local_v1();
        profile.policy_version = "fm.resources.v2".to_owned();
        assert_eq!(
            profile.resolve(ResourceRequest::absent()),
            Err(ResourcePolicyError::UnsupportedPolicyVersion {
                actual: "fm.resources.v2".to_owned(),
            })
        );

        let mut profile = ResourceProfile::local_v1();
        profile.defaults.timeout_seconds = profile.maximum.scalar.timeout_seconds + 1;
        assert_eq!(
            profile.resolve(ResourceRequest::absent()),
            Err(ResourcePolicyError::DefaultOverMaximum {
                profile: ResourceProfileName::Local,
                field: "timeout_seconds",
                default: 21_601,
                maximum: 21_600,
            })
        );
    }

    #[test]
    fn profile_maxima_are_monotonic_from_service_to_ci_to_local() {
        let service = ResourceProfile::service_v1();
        let ci = ResourceProfile::ci_v1();
        let local = ResourceProfile::local_v1();
        for ((_, service_value), ((_, ci_value), (_, local_value))) in
            resource_fields(&service.maximum.scalar).into_iter().zip(
                resource_fields(&ci.maximum.scalar)
                    .into_iter()
                    .zip(resource_fields(&local.maximum.scalar)),
            )
        {
            assert!(service_value <= ci_value);
            assert!(ci_value <= local_value);
        }
        assert!(service.maximum.max_simulation_work <= ci.maximum.max_simulation_work);
        assert!(ci.maximum.max_simulation_work <= local.maximum.max_simulation_work);
        assert!(service.maximum.max_trace_work <= ci.maximum.max_trace_work);
        assert!(ci.maximum.max_trace_work <= local.maximum.max_trace_work);
    }

    #[test]
    fn effective_policy_has_stable_serialized_field_order() {
        let resolved = ResourceProfile::service_v1()
            .resolve(ResourceRequest::absent())
            .expect("service defaults");
        let first = serde_json::to_vec(&resolved).expect("first JSON");
        let second = serde_json::to_vec(&resolved).expect("second JSON");
        assert_eq!(first, second);
        let text = String::from_utf8(first).expect("UTF-8 JSON");
        assert!(text.starts_with(
            "{\"schema_version\":1,\"policy_version\":\"fm.resources.v1\",\"profile\":\"service\""
        ));
        assert!(!text.contains("token"));
        assert!(!text.contains("secret"));
    }

    #[test]
    fn checked_work_rejects_overflow() {
        assert_eq!(
            checked_work(
                ResourceProfileName::Local,
                "overflow",
                u64::MAX,
                2,
                u64::MAX,
            ),
            Err(ResourcePolicyError::WorkOverflow { field: "overflow" })
        );
    }
}
