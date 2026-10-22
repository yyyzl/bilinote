// Compiled only by isolated tests. This is not Codex and has no network/auth code.
use std::io::{Read, Write};

fn main() {
    let args: Vec<_> = std::env::args().collect();
    let login = args.windows(2).any(|args| args == ["login", "status"]);
    let mut calls = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("fixture-calls.txt")
        .unwrap();
    writeln!(calls, "{}", if login { "login" } else { "exec" }).unwrap();
    if login {
        eprintln!("Logged in using ChatGPT");
        return;
    }
    assert!(args.iter().any(|arg| arg == "exec"));
    let mut prompt = String::new();
    std::io::stdin().read_to_string(&mut prompt).unwrap();
    std::fs::write("fixture-prompt.txt", prompt).unwrap();
    if std::path::Path::new("fixture-fail-next").exists() {
        std::fs::remove_file("fixture-fail-next").unwrap();
        println!(
            "{}",
            r#"{"type":"turn.failed","error":{"message":"rate limit 429"}}"#
        );
        std::process::exit(1);
    }
    println!(
        "{}",
        r#"{"type":"item.completed","item":{"type":"agent_message","text":"{\"summary\":\"fixture summary\",\"preview\":\"fixture preview\"}"}}"#
    );
    println!("{}", r#"{"type":"turn.completed"}"#);
}
