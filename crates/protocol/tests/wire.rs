use agai_protocol::*;
#[test]fn raw_paths_roundtrip_without_display(){for b in [b"-name\nfile".as_slice(),b"dir/\xff.cs", "код/файл.cs".as_bytes()]{let mut p=RepoPath::from_bytes(b).unwrap();p.display="wrong".into();let json=serde_json::to_vec(&p).unwrap();let p:RepoPath=serde_json::from_slice(&json).unwrap();assert_eq!(p.bytes().unwrap(),b);}}
#[test]fn unsafe_paths_rejected(){for p in [b"../x".as_slice(),b"/x",b".git/config",b"a/./b",b"a\0b"]{assert!(RepoPath::from_bytes(p).is_err());}}
#[test]fn forged_principal_rejected(){let s=r#"{"kind":"Hello","principal":"LocalUser"}"#;assert!(serde_json::from_str::<ReadRequest>(s).is_err());}
#[test]fn unsupported_version_before_access(){let m=RequestMeta{schema_version:2,request_id:uuid::Uuid::new_v4(),idempotency_key:None};assert_eq!(m.validate(false).unwrap_err().code,"UNSUPPORTED_VERSION");}
