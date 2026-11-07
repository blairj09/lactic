// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `lactic --mcp` is the stdio bridge an AI app (Claude Desktop, ChatGPT...) launches to reach
    // the coach tools of the running app. Anything else opens the app.
    if std::env::args().any(|a| a == "--mcp") {
        lactic_lib::mcp::run_stdio_bridge();
        return;
    }
    lactic_lib::run();
}
