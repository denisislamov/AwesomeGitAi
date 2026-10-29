use agai_storage::Store;
#[test] fn duplicate_write_returns_same_id(){let d=tempfile::tempdir().unwrap();let mut s=Store::open(&d.path().join("store.db")).unwrap();let a=s.append(1,"key","event",b"code").unwrap();assert_eq!(a,s.append(1,"key","event",b"code").unwrap());}
#[test] fn different_payload_same_key_conflicts(){let d=tempfile::tempdir().unwrap();let mut s=Store::open(&d.path().join("store.db")).unwrap();s.append(1,"key","event",b"code").unwrap();assert!(s.append(1,"key","event",b"different").is_err());}
#[test] fn acknowledged_bytes_survive_reopen(){let d=tempfile::tempdir().unwrap();let p=d.path().join("store.db");let id={let mut s=Store::open(&p).unwrap();s.append(1,"key","event",b"\xff\r\ncode").unwrap()};let s=Store::open(&p).unwrap();assert_eq!(s.read(&id).unwrap(),b"\xff\r\ncode");}
#[test] fn unsupported_schema_rejected(){let d=tempfile::tempdir().unwrap();let mut s=Store::open(&d.path().join("store.db")).unwrap();assert!(s.append(2,"key","event",b"code").is_err());}
#[test] fn two_gateways_share_receipt(){let d=tempfile::tempdir().unwrap();let p=d.path().join("store.db");let mut a=Store::open(&p).unwrap();let mut b=Store::open(&p).unwrap();let id=a.append(1,"key","event",b"code").unwrap();assert_eq!(id,b.append(1,"key","event",b"code").unwrap());}
#[test] fn simultaneous_writers_receive_one_durable_id(){
 let d=tempfile::tempdir().unwrap();let path=d.path().join("store.db");Store::open(&path).unwrap();
 let barrier=std::sync::Arc::new(std::sync::Barrier::new(2));
 let threads:Vec<_>=(0..2).map(|_|{let path=path.clone();let barrier=barrier.clone();std::thread::spawn(move||{let mut s=Store::open(&path).unwrap();barrier.wait();s.append(1,"same","event",b"code").unwrap()})}).collect();
 let ids:Vec<_>=threads.into_iter().map(|t|t.join().unwrap()).collect();assert_eq!(ids[0],ids[1]);assert_eq!(Store::open(&path).unwrap().read(&ids[0]).unwrap(),b"code");
}
#[test] fn conflict_does_not_replace_original_bytes(){
 let d=tempfile::tempdir().unwrap();let mut s=Store::open(&d.path().join("store.db")).unwrap();let id=s.append(1,"key","event",b"original").unwrap();assert_eq!(s.append(1,"key","other",b"new").unwrap_err(),"IDEMPOTENCY_CONFLICT");assert_eq!(s.read(&id).unwrap(),b"original");
}
