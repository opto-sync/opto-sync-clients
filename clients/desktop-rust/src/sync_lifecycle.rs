//! Host-neutral wake/acquire/run/release/close reducer.
//! Does not execute network IO or persist a lease; callers must fence actual
//! leases atomically in their storage authority before executing Commands.
#[derive(Clone,Copy,Debug,Eq,PartialEq)]
pub enum Phase { Idle, Acquiring, Running, Releasing, Closed }
#[derive(Clone,Copy,Debug,Eq,PartialEq)]
pub enum Event { Wake, Acquired{generation:u64}, CycleFinished{generation:u64}, Released{generation:u64}, Cancel, Close }
#[derive(Clone,Copy,Debug,Eq,PartialEq)]
pub enum Command { None, Acquire{generation:u64}, Run{generation:u64}, Release{generation:u64} }
#[derive(Clone,Copy,Debug,Eq,PartialEq)]
pub struct Snapshot { pub phase:Phase, pub generation:u64, pub trailing_wake:bool, pub closing:bool }
#[derive(Clone,Copy,Debug,Eq,PartialEq)]
pub enum ReducerError { UnexpectedEvent, StaleGeneration, Overflow }
impl Default for Snapshot {
  fn default()->Self{Self{phase:Phase::Idle,generation:0,trailing_wake:false,closing:false}}
}
impl Snapshot {
  pub fn apply(&self,event:Event)->Result<(Self,Command),ReducerError> {
    use Command as C;use Event as E;use Phase as P;use ReducerError as R;
    let mut next=*self;
    match (self.phase,event) {
      (P::Closed,_) => Err(R::UnexpectedEvent),
      (P::Idle,E::Wake) => {
        next.generation=self.generation.checked_add(1).ok_or(R::Overflow)?;
        next.phase=P::Acquiring;
        Ok((next,C::Acquire{generation:next.generation}))
      },
      (P::Idle,E::Close)=>{next.phase=P::Closed;next.closing=true;Ok((next,C::None))},
      (P::Acquiring|P::Running|P::Releasing,E::Wake)=>{
        if self.closing {return Err(R::UnexpectedEvent);}
        next.trailing_wake=true;Ok((next,C::None))
      },
      (P::Acquiring,E::Acquired{generation})=>{
        if generation!=self.generation{return Err(R::StaleGeneration);}
        next.phase=P::Running;Ok((next,C::Run{generation}))
      },
      (P::Running,E::CycleFinished{generation})=>{
        if generation!=self.generation{return Err(R::StaleGeneration);}
        next.phase=P::Releasing;Ok((next,C::Release{generation}))
      },
      (P::Releasing,E::Released{generation})=>{
        if generation!=self.generation{return Err(R::StaleGeneration);}
        if self.closing {next.phase=P::Closed;next.trailing_wake=false;return Ok((next,C::None));}
        if self.trailing_wake {
          next.generation=self.generation.checked_add(1).ok_or(R::Overflow)?;
          next.phase=P::Acquiring;next.trailing_wake=false;
          Ok((next,C::Acquire{generation:next.generation}))
        }else{next.phase=P::Idle;Ok((next,C::None))}
      },
      (P::Acquiring|P::Running|P::Releasing,E::Close)=>{
        next.closing=true;next.trailing_wake=false;
        // caller still holds the lane. It must settle/release the generation.
        Ok((next,C::None))
      },
      (P::Acquiring|P::Running,E::Cancel)=>{
        next.phase=P::Releasing;next.trailing_wake=false;
        Ok((next,C::Release{generation:next.generation}))
      },
      (P::Releasing,E::Cancel)=>Ok((next,C::None)),
      _=>Err(R::UnexpectedEvent)
    }
  }
}
#[cfg(test)]
mod tests{
use super::*;
#[test]fn trailing_wake_is_coalesced_into_one_new_generation(){
let s=Snapshot::default();let (s,cmd)=s.apply(Event::Wake).unwrap();
assert_eq!(cmd,Command::Acquire{generation:1});
let (s,_)=s.apply(Event::Wake).unwrap();
let (s,_)=s.apply(Event::Wake).unwrap();
let (s,_)=s.apply(Event::Acquired{generation:1}).unwrap();
let (s,_)=s.apply(Event::CycleFinished{generation:1}).unwrap();
let (s,cmd)=s.apply(Event::Released{generation:1}).unwrap();
assert_eq!(s.phase,Phase::Acquiring);assert_eq!(cmd,Command::Acquire{generation:2});
assert!(!s.trailing_wake);
}
#[test]fn stale_settlements_never_advance_a_lifecycle(){
let (s,_)=Snapshot::default().apply(Event::Wake).unwrap();
assert_eq!(s.apply(Event::Acquired{generation:0}),Err(ReducerError::StaleGeneration));
assert_eq!(s.phase,Phase::Acquiring);
}
#[test]fn close_drains_held_generation_without_reacquiring(){
let (s,_)=Snapshot::default().apply(Event::Wake).unwrap();
let (s,_)=s.apply(Event::Acquired{generation:1}).unwrap();
let (s,_)=s.apply(Event::Close).unwrap();
let (s,_)=s.apply(Event::CycleFinished{generation:1}).unwrap();
let (s,c)=s.apply(Event::Released{generation:1}).unwrap();
assert_eq!((s.phase,c),(Phase::Closed,Command::None));
}
#[test]fn arithmetic_wrap_and_illegal_events_fail_closed(){
let s=Snapshot{generation:u64::MAX,..Snapshot::default()};
assert_eq!(s.apply(Event::Wake),Err(ReducerError::Overflow));
assert_eq!(Snapshot::default().apply(Event::Released{generation:0}),Err(ReducerError::UnexpectedEvent));
}
}
