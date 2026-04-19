use std::{
    net::{SocketAddr, TcpStream},
    path::Path,
    process::Command as StdCommand,
    time::{Duration, Instant},
};

use tauri_plugin_shell::{
    process::CommandEvent,
    ShellExt,
};

fn wait_for_local_port(addr: SocketAddr, timeout: Duration) -> bool {
    let started_at = Instant::now();

    while started_at.elapsed() < timeout {
        if TcpStream::connect_timeout(&addr, Duration::from_millis(250)).is_ok() {
            return true;
        }

        std::thread::sleep(Duration::from_millis(300));
    }

    false
}

fn sidecar_path() -> Option<std::path::PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    Some(dir.join("api"))
}

#[cfg(target_family = "unix")]
fn ensure_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;

    if let Ok(metadata) = std::fs::metadata(path) {
        let mut permissions = metadata.permissions();
        let mode = permissions.mode();
        if mode & 0o111 == 0 {
            permissions.set_mode(mode | 0o755);
            let _ = std::fs::set_permissions(path, permissions);
        }
    }
}

#[cfg(target_os = "macos")]
fn prepare_macos_sidecar() {
    let _ = StdCommand::new("sh")
        .args(["-c", "lsof -ti:8000 | xargs kill -9 2>/dev/null || true"])
        .status();

    let current_exe = std::env::current_exe().ok();
    let bundle_root = current_exe
        .as_ref()
        .and_then(|path| path.ancestors().nth(3))
        .map(|path| path.to_path_buf());

    if let Some(path) = sidecar_path() {
        ensure_executable(&path);

        let mut quarantine_targets = Vec::new();
        if let Some(exe) = current_exe.as_ref() {
            quarantine_targets.push(exe.as_path());
        }
        quarantine_targets.push(path.as_path());
        if let Some(bundle_root) = bundle_root.as_ref() {
            quarantine_targets.push(bundle_root.as_path());
        }

        for target in quarantine_targets {
            let _ = StdCommand::new("xattr")
                .args(["-dr", "com.apple.quarantine"])
                .arg(target)
                .status();
        }

        log::info!("Sidecar macOS preparado em {}", path.display());
    } else {
        log::warn!("Nao foi possivel localizar o sidecar para preparar o macOS.");
    }
}

#[cfg(target_os = "windows")]
fn prepare_windows_sidecar() {
    let _ = StdCommand::new("cmd")
        .args(["/C", "for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :8000') do taskkill /F /PID %a 2>nul"])
        .status();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;

            #[cfg(target_os = "macos")]
            {
                prepare_macos_sidecar();
            }

            #[cfg(target_os = "windows")]
            {
                prepare_windows_sidecar();
            }

            let shell = app.shell();
            let (mut rx, sidecar) = shell
                .sidecar("api")
                .expect("sidecar 'api' não encontrado em src-tauri/binaries/")
                .spawn()
                .expect("falha ao iniciar o sidecar api");
            let sidecar_pid = sidecar.pid();

            tauri::async_runtime::spawn(async move {
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let line = String::from_utf8_lossy(&line).trim().to_string();
                            if !line.is_empty() {
                                log::info!("api[{sidecar_pid}] stdout: {line}");
                            }
                        }
                        CommandEvent::Stderr(line) => {
                            let line = String::from_utf8_lossy(&line).trim().to_string();
                            if !line.is_empty() {
                                log::error!("api[{sidecar_pid}] stderr: {line}");
                            }
                        }
                        CommandEvent::Error(error) => {
                            log::error!("api[{sidecar_pid}] erro: {error}");
                        }
                        CommandEvent::Terminated(payload) => {
                            log::error!(
                                "api[{sidecar_pid}] encerrado: code={:?} signal={:?}",
                                payload.code,
                                payload.signal
                            );
                        }
                        _ => {}
                    }
                }
            });

            let api_addr: SocketAddr = "127.0.0.1:8000"
                .parse()
                .expect("endereco local da API invalido");
            if wait_for_local_port(api_addr, Duration::from_secs(2)) {
                log::info!("API interna pronta em http://127.0.0.1:8000");
            } else {
                log::warn!(
                    "A API interna segue iniciando em segundo plano. A UI abrira a tela de carregamento e continuara aguardando a conexao."
                );
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
