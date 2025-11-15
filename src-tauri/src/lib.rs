use serde::{Serialize, Deserialize};
use std::{
  fs::File,
  io::{BufReader, Read},
  path::{Path, PathBuf},
};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use regex::Regex;
use calamine::{Reader, open_workbook_auto, DataType};
use scraper::{Html, Selector};

// ⬇ add near the other imports at the top
use std::fs;
use std::fs::create_dir_all;
// ⬇ add with the other use lines at the top if not present
use serde_json::{Value, Map};
use std::collections::{BTreeSet, HashMap};
use reqwest; // already implied by your other commands

/* ====================== Data types returned to the frontend ====================== */

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileNode {
  name: String,
  path: String,
  is_dir: bool,
  children: Option<Vec<FileNode>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FileValue {
  file_path: String,
  value: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApiTable {
  columns: Vec<String>,
  // each row is a flat map of column -> stringified value
  rows: Vec<HashMap<String, String>>,
}

/* ====================== .gitignore support (root only) ====================== */

fn load_root_gitignore(root: &Path) -> Option<Gitignore> {
  let gi_path = root.join(".gitignore");
  if !gi_path.is_file() {
    return None;
  }

  let mut builder = GitignoreBuilder::new(root);

  // In ignore 0.4, `add` -> Option<Error>. `Some(err)` means it failed to add.
  if let Some(_err) = builder.add(&gi_path) {
    // Treat a bad or unreadable .gitignore as "no filter"
    return None;
  }

  builder.build().ok()
}

// Prefer matching against a path relative to the chosen root.
fn is_ignored(root: &Path, gi: Option<&Gitignore>, candidate: &Path, is_dir: bool) -> bool {
  if let Some(matcher) = gi {
    let rel = candidate.strip_prefix(root).unwrap_or(candidate);
    return matcher.matched_path_or_any_parents(rel, is_dir).is_ignore();
  }
  false
}

/* ====================== Tree building (with .gitignore filtering) ====================== */

fn build_tree_rec(root: &Path, dir: &Path, gi: Option<&Gitignore>) -> std::io::Result<FileNode> {
  let name = dir.file_name()
    .map(|s| s.to_string_lossy().to_string())
    .unwrap_or_else(|| dir.to_string_lossy().to_string());

  // If this directory (not the root) is ignored, return an empty dir node (caller keeps/skips)
  if dir != root && is_ignored(root, gi, dir, true) {
    return Ok(FileNode {
      name,
      path: dir.to_string_lossy().to_string(),
      is_dir: true,
      children: Some(vec![]),
    });
  }

  let mut children: Vec<FileNode> = Vec::new();

  for entry in std::fs::read_dir(dir)? {
    let ent = match entry {
      Ok(e) => e,
      Err(_) => continue,
    };
    let p = ent.path();
    let fname = ent.file_name();
    let fname_str = fname.to_string_lossy();

    // Skip dotfiles/dirs for readability (you can remove this if you want full fidelity)
    if fname_str.starts_with('.') {
      continue;
    }

    let md = match ent.metadata() {
      Ok(m) => m,
      Err(_) => continue,
    };
    let is_dir = md.is_dir();

    // Apply root .gitignore rules
    if is_ignored(root, gi, &p, is_dir) {
      continue;
    }

    if is_dir {
      let node = build_tree_rec(root, &p, gi)?;
      children.push(node);
    } else {
      children.push(FileNode {
        name: p.file_name().unwrap_or_default().to_string_lossy().to_string(),
        path: p.to_string_lossy().to_string(),
        is_dir: false,
        children: None,
      });
    }
  }

  // Sort: dirs first, then files, by name (case-insensitive)
  children.sort_by(|a, b| {
    match (a.is_dir, b.is_dir) {
      (true, false) => std::cmp::Ordering::Less,
      (false, true) => std::cmp::Ordering::Greater,
      _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    }
  });

  Ok(FileNode {
    name,
    path: dir.to_string_lossy().to_string(),
    is_dir: true,
    children: Some(children),
  })
}

fn build_tree_with_gitignore(root: &Path) -> std::io::Result<FileNode> {
  let gi = load_root_gitignore(root);
  build_tree_rec(root, root, gi.as_ref())
}

/* ====================== ASCII-only file read (for selection content) ====================== */

fn ascii_only_string(mut reader: impl Read, max_bytes: usize) -> std::io::Result<String> {
  let mut buf = Vec::with_capacity(max_bytes.min(512 * 1024));
  reader.take(max_bytes as u64).read_to_end(&mut buf)?;
  let mut out = String::with_capacity(buf.len());
  for &b in buf.iter() {
    match b {
      9 | 10 | 13 => out.push(b as char),       // \t \n \r
      32..=126 => out.push(b as char),          // printable ASCII
      _ => {}
    }
  }
  Ok(out)
}

/* ====================== Tauri commands ====================== */

#[tauri::command]
fn scan_dir(path: String) -> Result<FileNode, String> {
  let p = PathBuf::from(&path);
  if !p.exists() {
    return Err(format!("Path does not exist: {}", path));
  }
  build_tree_with_gitignore(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_ascii_files(paths: Vec<String>, max_bytes: Option<usize>) -> Result<Vec<FileValue>, String> {
  let max = max_bytes.unwrap_or(512 * 1024);
  let mut out = Vec::with_capacity(paths.len());
  for p in paths {
    let pb = PathBuf::from(&p);
    if pb.is_file() {
      let f = File::open(&pb).map_err(|e| format!("{}: {}", p, e))?;
      let reader = BufReader::new(f);
      let text = ascii_only_string(reader, max).map_err(|e| e.to_string())?;
      out.push(FileValue { file_path: p, value: text });
    }
  }
  Ok(out)
}

/* ====================== Entry point wired for main.rs ====================== */

pub fn run() {
  tauri::Builder::default()
    // plugins you use on the frontend
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_clipboard_manager::init())
    .plugin(tauri_plugin_fs::init())
    // register commands
    .invoke_handler(tauri::generate_handler![
      scan_dir,
      read_ascii_files,
      inspect_excel,
      extract_excel_units,
      extract_regex_blocks,
      extract_html_blocks,
      extract_api_units,            // <— add this line
      fetch_api_table,            // <-- add this
      fetch_api_table_from_url    // ⬅️ add this
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PromptUnit {
  id: String,
  body: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  meta: Option<serde_json::Value>,
}

/* ---------- Excel inspector ---------- */
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExcelSheetInfo {
  name: String,
  columns: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExcelInspector {
  path: String,
  sheets: Vec<ExcelSheetInfo>,
}

#[tauri::command]
fn inspect_excel(path: String) -> Result<ExcelInspector, String> {
  let p = PathBuf::from(&path);
  if !p.exists() { return Err("File not found".into()); }
  let mut wb = open_workbook_auto(&p).map_err(|e| e.to_string())?;

  let mut sheets: Vec<ExcelSheetInfo> = Vec::new();

  for sname in wb.sheet_names().to_owned() {
    if let Some(Ok(range)) = wb.worksheet_range(&sname) {
      // Find header row (first non-empty row)
      let mut header: Vec<String> = Vec::new();
      'rows: for row in range.rows() {
        if row.iter().any(|c| !c.is_empty()) {
          header = row.iter().enumerate().map(|(i, c)| {
            match c {
              DataType::String(s) => if s.trim().is_empty() { format!("col{}", i+1) } else { s.trim().to_string() },
              DataType::Float(f) => format!("{}", f),
              DataType::Int(i) => format!("{}", i),
              DataType::Bool(b) => format!("{}", b),
              _ => format!("col{}", i+1),
            }
          }).collect();
          break 'rows;
        }
      }
      if header.is_empty() {
        // Fallback: number columns based on first row length
        if let Some(first) = range.rows().next() {
          header = (0..first.len()).map(|i| format!("col{}", i+1)).collect();
        }
      }
      sheets.push(ExcelSheetInfo { name: sname.to_string(), columns: header });
    }
  }

  Ok(ExcelInspector { path, sheets })
}

/* ---------- Excel units ---------- */
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExcelConfig {
  sheet: String,
  id_column: String,
  description_columns: Vec<String>,
}

#[tauri::command]
fn extract_excel_units(path: String, config: ExcelConfig) -> Result<Vec<PromptUnit>, String> {
  let mut wb = open_workbook_auto(&path).map_err(|e| e.to_string())?;
  let range = wb.worksheet_range(&config.sheet)
    .ok_or_else(|| format!("Sheet not found: {}", config.sheet))?
    .map_err(|e| e.to_string())?;

  // Find header row
  let mut header_idx: usize = 0;
  let mut header: Vec<String> = Vec::new();
  for (i, row) in range.rows().enumerate() {
    if row.iter().any(|c| !c.is_empty()) {
      header = row.iter().enumerate().map(|(j, c)| cell_to_string(c).unwrap_or_else(|| format!("col{}", j+1))).collect();
      header_idx = i;
      break;
    }
  }
  if header.is_empty() {
    return Err("Could not detect header row".into());
  }

  let id_idx = header.iter().position(|h| h.eq_ignore_ascii_case(&config.id_column))
    .ok_or_else(|| format!("ID column not found: {}", config.id_column))?;

  let desc_indices: Vec<usize> = config.description_columns.iter()
    .map(|name| header.iter().position(|h| h.eq_ignore_ascii_case(name))
      .ok_or_else(|| format!("Description column not found: {}", name)))
    .collect::<Result<_,_>>()?;

  let mut units: Vec<PromptUnit> = Vec::new();

  for (i, row) in range.rows().enumerate() {
    if i <= header_idx { continue; }
    let id = row.get(id_idx).and_then(cell_to_string).unwrap_or_default().trim().to_string();
    if id.is_empty() { continue; }

    let mut parts: Vec<String> = Vec::new();
    for &di in desc_indices.iter() {
      if let Some(s) = row.get(di).and_then(cell_to_string) {
        let v = s.trim();
        if !v.is_empty() { parts.push(v.to_string()); }
      }
    }
    let body = parts.join("\n");
    if body.is_empty() { continue; }

    units.push(PromptUnit {
      id,
      body,
      meta: Some(serde_json::json!({
        "sheet": config.sheet,
        "rowIndex": i
      })),
    });
  }

  Ok(units)
}

fn cell_to_string(c: &DataType) -> Option<String> {
  match c {
    DataType::String(s) => Some(s.to_string()),
    DataType::Float(f) => Some(if f.fract() == 0.0 { format!("{:.0}", f) } else { f.to_string() }),
    DataType::Int(i) => Some(i.to_string()),
    DataType::Bool(b) => Some(b.to_string()),
    DataType::Empty => None,
    _ => Some(c.to_string()),
  }
}

/* ---------- Regex blocks ---------- */
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegexConfig {
  delimiter: String,
  id_capture: Option<String>,
  flags: Option<String>,
}

#[tauri::command]
fn extract_regex_blocks(path: String, config: RegexConfig) -> Result<Vec<PromptUnit>, String> {
  let data = std::fs::read(&path).map_err(|e| e.to_string())?;
  let text = String::from_utf8_lossy(&data).into_owned();

  let mut delim_builder = regex::RegexBuilder::new(&config.delimiter);
  if let Some(f) = &config.flags {
    if f.contains('i') { delim_builder.case_insensitive(true); }
    if f.contains('m') { delim_builder.multi_line(true); }
    if f.contains('s') { delim_builder.dot_matches_new_line(true); }
  }
  let delim = delim_builder.build().map_err(|e| e.to_string())?;

  let id_re = if let Some(idc) = &config.id_capture {
    let mut idb = regex::RegexBuilder::new(idc);
    if let Some(f) = &config.flags {
      if f.contains('i') { idb.case_insensitive(true); }
      if f.contains('m') { idb.multi_line(true); }
      if f.contains('s') { idb.dot_matches_new_line(true); }
    }
    Some(idb.build().map_err(|e| e.to_string())?)
  } else { None };

  // Slice text by delimiter occurrences
  let mut units: Vec<PromptUnit> = Vec::new();
  let mut starts: Vec<usize> = delim.find_iter(&text).map(|m| m.start()).collect();
  if starts.is_empty() {
    // No delimiter found → create one whole unit
    let id = id_re.as_ref()
      .and_then(|re| re.captures(&text).and_then(|c| c.get(1)).map(|m| m.as_str().to_string()))
      .unwrap_or_else(|| "1".into());
    let body = text.trim().to_string();
    if !body.is_empty() {
      units.push(PromptUnit { id, body, meta: None });
    }
    return Ok(units);
  }
  starts.insert(0, 0);
  starts.push(text.len());

  for w in starts.windows(2) {
    let s = w[0];
    let e = w[1];
    if e <= s { continue; }
    let block = text[s..e].trim();
    if block.is_empty() { continue; }
    let id = if let Some(re) = &id_re {
      re.captures(block).and_then(|c| c.get(1)).map(|m| m.as_str().to_string())
        .unwrap_or_else(|| format!("{}", units.len()+1))
    } else {
      format!("{}", units.len()+1)
    };
    units.push(PromptUnit { id, body: block.to_string(), meta: None });
  }

  Ok(units)
}

/* ---------- HTML (CSS) blocks — best practice: parse DOM, not regex ---------- */
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct HtmlConfig {
  item_selector: String,
  id_selector: Option<String>,
  id_attr: Option<String>,       // defaults to "id"
  desc_selector: Option<String>,
}

#[tauri::command]
fn extract_html_blocks(path: String, config: HtmlConfig) -> Result<Vec<PromptUnit>, String> {
  let data = std::fs::read(&path).map_err(|e| e.to_string())?;
  let text = String::from_utf8_lossy(&data).into_owned();

  let doc = Html::parse_document(&text);
  let item_sel = Selector::parse(&config.item_selector)
    .map_err(|_| "Invalid itemSelector".to_string())?;

  let id_sel = match &config.id_selector {
    Some(s) if !s.trim().is_empty() => Some(Selector::parse(s).map_err(|_| "Invalid idSelector".to_string())?),
    _ => None
  };
  let desc_sel = match &config.desc_selector {
    Some(s) if !s.trim().is_empty() => Some(Selector::parse(s).map_err(|_| "Invalid descSelector".to_string())?),
    _ => None
  };
  let id_attr = config.id_attr.as_deref().unwrap_or("id");

  let mut units: Vec<PromptUnit> = Vec::new();

  for (i, el) in doc.select(&item_sel).enumerate() {
    // resolve id
    let id = if let Some(sel) = &id_sel {
      if let Some(node) = el.select(sel).next() {
        if let Some(v) = node.value().attr(id_attr) {
          v.to_string()
        } else {
          let text = node.text().collect::<String>().trim().to_string();
          if text.is_empty() { format!("{}", i+1) } else { text }
        }
      } else {
        format!("{}", i+1)
      }
    } else {
      if let Some(v) = el.value().attr(id_attr) {
        v.to_string()
      } else {
        format!("{}", i+1)
      }
    };

    // resolve description text
    let body = if let Some(dsel) = &desc_sel {
      let mut buf = String::new();
      for n in el.select(dsel) {
        let t = n.text().collect::<String>();
        if !t.trim().is_empty() {
          if !buf.is_empty() { buf.push('\n'); }
          buf.push_str(t.trim());
        }
      }
      if buf.is_empty() {
        // fallback to full item text
        el.text().collect::<String>().trim().to_string()
      } else { buf }
    } else {
      el.text().collect::<String>().trim().to_string()
    };

    if body.is_empty() { continue; }
    units.push(PromptUnit { id, body, meta: None });
  }

  Ok(units)
}

// ADD this new command (async)
#[tauri::command]
async fn extract_api_units(
  endpoint: String,
  path: String,
  which: String,                       // "items" | "notes"
  headers: Option<HashMap<String, String>>,
) -> Result<Vec<PromptUnit>, String> {
  // 1) Read the selected file
  let data = std::fs::read(&path).map_err(|e| e.to_string())?;
  let html_text = String::from_utf8_lossy(&data).into_owned();

  // 2) POST to the endpoint as JSON
  let client = reqwest::Client::builder()
    .user_agent("rag-util/1.0")
    .build()
    .map_err(|e| e.to_string())?;

  let mut req = client
    .post(&endpoint)
    .header(reqwest::header::CONTENT_TYPE, "application/json");

  if let Some(h) = headers.as_ref() {
    for (k,v) in h {
      req = req.header(k, v);
    }
  }

  let payload = serde_json::json!({ "html": html_text });
  let resp = req.json(&payload).send().await.map_err(|e| e.to_string())?;
  if !resp.status().is_success() {
    return Err(format!("API error {} from {}", resp.status(), endpoint));
  }

  // 3) Accept several response shapes
  //    - array of objects
  //    - {items:[...]} or {notes:[...]}
  //    Each object should have {code, items_text? / notes_text?}
  let v: Value = resp.json().await.map_err(|e| e.to_string())?;
  let list: Vec<Value> = if let Some(arr) = v.as_array() {
    arr.clone()
  } else if let Some(arr) = v.get("items").and_then(|x| x.as_array()) {
    arr.clone()
  } else if let Some(arr) = v.get("notes").and_then(|x| x.as_array()) {
    arr.clone()
  } else {
    vec![v]
  };

  let take_key = if which.to_lowercase().starts_with('n') { "notes_text" } else { "items_text" };
  let mut out: Vec<PromptUnit> = Vec::new();

  for item in list {
    let code = item.get("code").and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    let body = item.get(take_key).and_then(|x| x.as_str()).unwrap_or("").trim().to_string();
    if !code.is_empty() && !body.is_empty() {
      out.push(PromptUnit { id: code, body, meta: None });
    }
  }

  Ok(out)
}

fn json_to_string(v: &Value) -> String {
  match v {
    Value::Null => "".into(),
    Value::Bool(b) => b.to_string(),
    Value::Number(n) => n.to_string(),
    Value::String(s) => s.clone(),
    other => serde_json::to_string(other).unwrap_or_default(),
  }
}

// Find an array of objects in common shapes: top-level array,
// or under items/rows/data/result/notes/records, else first array-of-objects found.
fn find_array_of_objects(v: &Value) -> Option<Vec<Map<String, Value>>> {
  if let Some(arr) = v.as_array() {
    let objs: Vec<_> = arr.iter().filter_map(|x| x.as_object().cloned()).collect();
    if !objs.is_empty() { return Some(objs); }
  }
  if let Some(obj) = v.as_object() {
    for key in ["items","rows","data","result","notes","records"] {
      if let Some(val) = obj.get(key) {
        if let Some(arr) = val.as_array() {
          let objs: Vec<_> = arr.iter().filter_map(|x| x.as_object().cloned()).collect();
          if !objs.is_empty() { return Some(objs); }
        }
      }
    }
    for (_k, val) in obj {
      if let Some(arr) = val.as_array() {
        let objs: Vec<_> = arr.iter().filter_map(|x| x.as_object().cloned()).collect();
        if !objs.is_empty() { return Some(objs); }
      }
    }
  }
  None
}

#[tauri::command]
async fn fetch_api_table(endpoint: String, path: String) -> Result<ApiTable, String> {
  let data = std::fs::read(&path).map_err(|e| e.to_string())?;
  let html_text = String::from_utf8_lossy(&data).into_owned();

  let client = reqwest::Client::builder()
    .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36")
    .build()
    .map_err(|e| e.to_string())?;

  let resp = client
    .post(&endpoint)
    .header(reqwest::header::CONTENT_TYPE, "application/json")
    .json(&serde_json::json!({ "data": html_text }))    // ⬅️ changed key to "data"
    .send()
    .await
    .map_err(|e| e.to_string())?;

  if !resp.status().is_success() {
    return Err(format!("API error {} from {}", resp.status(), endpoint));
  }

  let v: Value = resp.json().await.map_err(|e| e.to_string())?;
  let objs = find_array_of_objects(&v)
    .ok_or_else(|| "No array of objects in API response".to_string())?;

  let mut cols: BTreeSet<String> = BTreeSet::new();
  for o in &objs { for k in o.keys() { cols.insert(k.clone()); } }
  let columns: Vec<String> = cols.into_iter().collect();

  let mut rows: Vec<HashMap<String, String>> = Vec::new();
  for o in objs {
    let mut r = HashMap::new();
    for c in &columns {
      let s = o.get(c).map(json_to_string).unwrap_or_default();
      r.insert(c.clone(), s);
    }
    rows.push(r);
  }

  Ok(ApiTable { columns, rows })
}

// ⬇ put this helper anywhere above `run()` (e.g., with other helpers)
fn sanitize_for_filename(input: &str) -> String {
  // Keep alnum, dot, dash, underscore. Everything else -> underscore.
  let mut out: String = input
    .chars()
    .map(|c| {
      if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' {
        c
      } else {
        '_'
      }
    })
    .collect();
  while out.contains("__") {
    out = out.replace("__", "_");
  }
  out.trim_matches('_').to_string()
}

#[tauri::command]
fn save_chunk_file(dir: String, base: String, ext: Option<String>, contents: String) -> Result<String, String> {
  let dir_path = PathBuf::from(&dir);
  // Ensure directory exists
  create_dir_all(&dir_path).map_err(|e| format!("mkdir failed: {}", e))?;

  let ext_sanitized = sanitize_for_filename(ext.unwrap_or_else(|| "md".to_string()).trim_matches('.'));
  let mut base_sanitized = sanitize_for_filename(&base);
  if base_sanitized.is_empty() {
    base_sanitized = "chunk".to_string();
  }

  // Build unique filename: base.ext, base--2.ext, base--3.ext, ...
  let mut attempt: usize = 1;
  let final_path = loop {
    let candidate = if attempt == 1 {
      dir_path.join(format!("{}.{}", base_sanitized, ext_sanitized))
    } else {
      dir_path.join(format!("{}--{}.{}", base_sanitized, attempt, ext_sanitized))
    };
    if !candidate.exists() {
      break candidate;
    }
    attempt += 1;
    if attempt > 9999 {
      return Err("Failed to create a unique filename (too many conflicts)".into());
    }
  };

  fs::write(&final_path, contents).map_err(|e| format!("write failed: {}", e))?;
  Ok(final_path.to_string_lossy().to_string())
}

// ASCII filter for downloaded bytes (keeps \t \n \r and printable ASCII)
fn ascii_only_from_bytes(buf: &[u8]) -> String {
  let mut out = String::with_capacity(buf.len());
  for &b in buf.iter() {
    match b {
      9 | 10 | 13 => out.push(b as char),       // \t \n \r
      32..=126 => out.push(b as char),          // printable ASCII
      _ => {}
    }
  }
  out
}

#[tauri::command]
async fn fetch_api_table_from_url(endpoint: String, url: String) -> Result<ApiTable, String> {
  // 1) Download the source URL (try to mimic a real browser)
  let client = reqwest::Client::builder()
    .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36")
    .redirect(reqwest::redirect::Policy::limited(10))
    .build()
    .map_err(|e| e.to_string())?;

  let mut html_text = {
    let resp = client
      .get(&url)
      .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
      .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9")
      .send()
      .await
      .map_err(|e| format!("GET {} failed: {}", url, e))?;

    if !resp.status().is_success() {
      return Err(format!("GET {} returned {}", url, resp.status()));
    }

    let bytes = resp.bytes().await.map_err(|e| e.to_string())?;
    String::from_utf8_lossy(&bytes).into_owned()
  };

  // 1b) eCFR-specific fallback: if we don't see the expected markers, try /current/
  let looks_like_app_shell = !html_text.contains("flush-paragraph-2") && url.contains("ecfr.gov");
  if looks_like_app_shell && url.contains("/on/") {
    if let Some(current_url) = url.replace("/on/", "/current/").into() {
      let resp2 = client
        .get(&current_url)
        .header(reqwest::header::ACCEPT, "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header(reqwest::header::ACCEPT_LANGUAGE, "en-US,en;q=0.9")
        .send()
        .await
        .map_err(|e| format!("GET {} failed: {}", current_url, e))?;

      if resp2.status().is_success() {
        let bytes2 = resp2.bytes().await.map_err(|e| e.to_string())?;
        let html2 = String::from_utf8_lossy(&bytes2).into_owned();
        // Only replace if the fallback actually looks better
        if html2.contains("flush-paragraph-2") {
          html_text = html2;
        }
      }
    }
  }

  // 2) Post the ASCII/UTF-8 text to your extraction API as { data: ... }
  let resp = client
    .post(&endpoint)
    .header(reqwest::header::CONTENT_TYPE, "application/json")
    .json(&serde_json::json!({ "data": html_text }))  // ⬅️ your FastAPI expects "data"
    .send()
    .await
    .map_err(|e| format!("POST {} failed: {}", endpoint, e))?;

  if !resp.status().is_success() {
    return Err(format!("Extraction API error {} from {}", resp.status(), endpoint));
  }

  let v: Value = resp.json().await.map_err(|e| e.to_string())?;
  let objs = find_array_of_objects(&v)
    .ok_or_else(|| "No array of objects in extraction response".to_string())?;

  // Normalize to columns + rows table
  let mut cols: BTreeSet<String> = BTreeSet::new();
  for o in &objs { for k in o.keys() { cols.insert(k.clone()); } }
  let columns: Vec<String> = cols.into_iter().collect();

  let mut rows: Vec<HashMap<String, String>> = Vec::new();
  for o in objs {
    let mut r = HashMap::new();
    for c in &columns {
      let s = o.get(c).map(json_to_string).unwrap_or_default();
      r.insert(c.clone(), s);
    }
    rows.push(r);
  }

  Ok(ApiTable { columns, rows })
}