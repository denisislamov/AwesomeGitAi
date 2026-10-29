use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
fn main() {
    let root = PathBuf::from(std::env::args_os().nth(1).expect("fixture path"));
    let t = Instant::now();
    let r = agai_git::GitReader::new(&root).unwrap();
    let page = r.history(None, 200).unwrap();
    assert_eq!(page.commits.len(), 200);
    let startup = t.elapsed();
    let mut hot = vec![];
    for _ in 0..5 {
        let t = Instant::now();
        r.history(None, 200).unwrap();
        hot.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    let (_w, rx) = agai_host::watch::Watch::start(root.clone()).unwrap();
    rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    let mut watch = vec![];
    for i in 0..10 {
        let t = Instant::now();
        std::fs::write(root.join("src/File0.cs"), format!("class Probe{i} {{}}\n")).unwrap();
        rx.recv_timeout(Duration::from_secs(3)).unwrap().unwrap();
        watch.push(t.elapsed().as_secs_f64() * 1000.0);
    }
    watch.sort_by(f64::total_cmp);
    println!(
        "startup_to_first_200_commits_ms={} hot_ms={hot:?} watch_p95_ms={} (10 samples)",
        startup.as_secs_f64() * 1000.0,
        watch[9]
    );
    assert!(startup < Duration::from_secs(5));
    assert!(hot.iter().all(|x| *x < 2000.0));
    assert!(watch[9] < 1000.0);
}
