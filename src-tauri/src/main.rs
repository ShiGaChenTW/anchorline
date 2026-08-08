// Windows release build 不要開一個 console 視窗
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    anchorline_lib::run()
}
