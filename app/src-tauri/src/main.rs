// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `lactic --mcp` (the stdio bridge for AI apps) is handled in run().
    lactic_lib::run();
}
