use agai_git::GitReader;
use agai_protocol::*;
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
        mpsc::{Receiver, TrySendError, sync_channel},
    },
    thread,
    time::Duration,
};
/// Periodic authoritative rescan is also the recovery path for dropped notifications.
/// One queued update coalesces bursts without permanently losing the latest state.
pub struct Watch {
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
impl Watch {
    pub fn start(path: PathBuf) -> Result<(Self, Receiver<Result<RepoState>>)> {
        let reader = GitReader::new(&path)?;
        let (tx, rx) = sync_channel(1);
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let thread = thread::spawn(move || {
            let mut last = String::new();
            while !flag.load(Ordering::Relaxed) {
                let state = reader.state();
                let signature = match &state {
                    Ok(s) => s.generation.clone(),
                    Err(e) => e.code.clone(),
                };
                if signature != last {
                    match tx.try_send(state) {
                        Ok(()) => last = signature,
                        Err(TrySendError::Full(_)) => {}
                        Err(TrySendError::Disconnected(_)) => break,
                    }
                }
                thread::sleep(Duration::from_millis(200));
            }
        });
        Ok((
            Self {
                stop,
                thread: Some(thread),
            },
            rx,
        ))
    }
}
impl Drop for Watch {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}
