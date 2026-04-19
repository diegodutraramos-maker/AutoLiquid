use tauri_plugin_shell::ShellExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Inicia o backend Python (api) como sidecar
            let shell = app.shell();
            let _sidecar = shell
                .sidecar("api")
                .expect("sidecar 'api' não encontrado em src-tauri/binaries/")
                .spawn()
                .expect("falha ao iniciar o sidecar api");

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
