// A small, forgiving lexer for POSIX-style shell commands. It only feeds
// heuristics: it never executes or expands anything, and it doesn't need to
// be complete. When in doubt the Bash guard allows the command.
//
// parseShell(src) returns:
//   { ok, pipelines: [{ start, end, background, stages: [{ start, end,
//       words: [{ text, start, end, quoted }], redirects: [{ op, fd, target }] }] }] }
// `text` has quotes removed; `$(...)` and backticks are kept verbatim.

function matchParen(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      i++;
    } else if (c === "'") {
      const j = src.indexOf("'", i + 1);
      if (j === -1) return -1;
      i = j;
    } else if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

export function parseShell(src) {
  const n = src.length;
  const pipelines = [];
  let ok = true;
  let i = 0;
  let word = null;
  let stage = { start: -1, end: -1, words: [], redirects: [] };
  let pipeline = { start: -1, end: -1, background: false, stages: [] };
  let pendingRedirect = null;
  let heredocs = [];

  const startWord = (pos) => {
    if (!word) word = { text: '', start: pos, end: pos, quoted: false };
    if (stage.start === -1) stage.start = pos;
  };
  const endWord = () => {
    if (!word) return;
    word.end = i;
    if (pendingRedirect) {
      pendingRedirect.target = word.text;
      stage.redirects.push(pendingRedirect);
      if (pendingRedirect.op === '<<' || pendingRedirect.op === '<<-') {
        heredocs.push({ delim: word.text, strip: pendingRedirect.op === '<<-' });
      }
      pendingRedirect = null;
    } else {
      stage.words.push(word);
    }
    word = null;
  };
  const endStage = (pos) => {
    endWord();
    if (pendingRedirect) {
      stage.redirects.push(pendingRedirect);
      pendingRedirect = null;
    }
    stage.end = pos;
    if (stage.words.length || stage.redirects.length) {
      if (pipeline.start === -1) pipeline.start = stage.start;
      pipeline.stages.push(stage);
    }
    stage = { start: -1, end: -1, words: [], redirects: [] };
  };
  const endPipeline = (pos, background) => {
    endStage(pos);
    pipeline.end = pos;
    pipeline.background = background;
    if (pipeline.stages.length) pipelines.push(pipeline);
    pipeline = { start: -1, end: -1, background: false, stages: [] };
  };
  const skipHeredocs = () => {
    // i points just past a newline; consume pending here-document bodies.
    for (const h of heredocs) {
      for (;;) {
        if (i >= n) {
          ok = false;
          break;
        }
        let eol = src.indexOf('\n', i);
        if (eol === -1) eol = n;
        let line = src.slice(i, eol);
        if (h.strip) line = line.replace(/^\t+/, '');
        i = eol + 1;
        if (line === h.delim) break;
      }
    }
    heredocs = [];
  };

  while (i < n) {
    const c = src[i];
    if (c === '\\') {
      if (src[i + 1] === '\n') {
        i += 2;
        continue;
      }
      startWord(i);
      word.text += src[i + 1] ?? '';
      i += 2;
      continue;
    }
    if (c === "'") {
      startWord(i);
      const j = src.indexOf("'", i + 1);
      word.quoted = true;
      if (j === -1) {
        ok = false;
        word.text += src.slice(i + 1);
        i = n;
        break;
      }
      word.text += src.slice(i + 1, j);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      startWord(i);
      word.quoted = true;
      i++;
      while (i < n && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < n && '"\\$`\n'.includes(src[i + 1])) {
          word.text += src[i + 1];
          i += 2;
        } else if (src[i] === '$' && src[i + 1] === '(') {
          const j = matchParen(src, i + 1);
          if (j === -1) {
            ok = false;
            i = n;
            break;
          }
          word.text += src.slice(i, j + 1);
          i = j + 1;
        } else {
          word.text += src[i];
          i++;
        }
      }
      if (i >= n) ok = false;
      i++;
      continue;
    }
    if (c === '$' && src[i + 1] === '(') {
      startWord(i);
      const j = matchParen(src, i + 1);
      if (j === -1) {
        ok = false;
        word.text += src.slice(i);
        i = n;
        break;
      }
      word.text += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '`') {
      startWord(i);
      const j = src.indexOf('`', i + 1);
      if (j === -1) {
        ok = false;
        word.text += src.slice(i);
        i = n;
        break;
      }
      word.text += src.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
      i++;
      continue;
    }
    if (c === '\n') {
      endPipeline(i, false);
      i++;
      if (heredocs.length) skipHeredocs();
      continue;
    }
    if (c === '#' && !word) {
      const eol = src.indexOf('\n', i);
      i = eol === -1 ? n : eol;
      continue;
    }
    if (c === ';') {
      endPipeline(i, false);
      i++;
      continue;
    }
    if (c === '&') {
      if (src[i + 1] === '&') {
        endPipeline(i, false);
        i += 2;
        continue;
      }
      if (src[i + 1] === '>') {
        endWord();
        if (stage.start === -1) stage.start = i;
        i += 2;
        let op = '&>';
        if (src[i] === '>') {
          op = '&>>';
          i++;
        }
        pendingRedirect = { op, fd: null, target: null };
        continue;
      }
      endPipeline(i, true);
      i++;
      continue;
    }
    if (c === '|') {
      if (src[i + 1] === '|') {
        endPipeline(i, false);
        i += 2;
        continue;
      }
      endStage(i);
      i += src[i + 1] === '&' ? 2 : 1;
      continue;
    }
    if (c === '(' || c === ')' || c === '{' && !word && /\s/.test(src[i + 1] ?? ' ') || c === '}' && !word) {
      endPipeline(i, false);
      i++;
      continue;
    }
    if (c === '>' || c === '<') {
      let fd = null;
      if (word && !word.quoted && /^\d+$/.test(word.text)) {
        fd = word.text;
        word = null;
      }
      endWord();
      if (stage.start === -1) stage.start = i;
      let op = c;
      i++;
      if (c === '>' && src[i] === '>') {
        op = '>>';
        i++;
      } else if (c === '<' && src[i] === '<') {
        op = '<<';
        i++;
        if (src[i] === '-') {
          op = '<<-';
          i++;
        } else if (src[i] === '<') {
          op = '<<<';
          i++;
        }
      }
      if (src[i] === '&') {
        op += '&';
        i++;
      } else if (c === '>' && src[i] === '|') {
        i++;
      }
      pendingRedirect = { op, fd, target: null };
      continue;
    }
    startWord(i);
    word.text += c;
    i++;
  }
  if (word) word.end = n;
  endPipeline(n, false);
  if (heredocs.length) ok = false;
  return { ok, pipelines };
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

// Wrappers that run another command: returns how many words to skip after
// the wrapper name (flags are skipped separately).
const WRAPPERS = {
  sudo: new Set(['-u', '-g', '-h', '-p', '-C', '-D', '-r', '-t', '-U']),
  doas: new Set(['-u', '-C']),
  env: new Set(['-u', '-C', '-S']),
  time: new Set(['-f', '-o']),
  nice: new Set(['-n']),
  nohup: new Set(),
  command: new Set(),
  exec: new Set(['-a']),
  builtin: new Set(),
  timeout: new Set(['-s', '-k', '--signal', '--kill-after']),
  stdbuf: new Set(),
  caffeinate: new Set(),
};

export function baseName(cmd) {
  const s = cmd.replace(/\\/g, '/');
  return s.slice(s.lastIndexOf('/') + 1);
}

// The words of a stage starting at the command being run: leading
// VAR=value assignments and wrapper commands (sudo, env, timeout...) are
// skipped. Returns { words, wrappers } (wrappers: names skipped).
export function commandWords(stage) {
  const w = stage.words;
  const wrappers = [];
  let k = 0;
  for (;;) {
    while (k < w.length && ASSIGNMENT.test(w[k].text)) k++;
    if (k >= w.length) break;
    const name = baseName(w[k].text);
    if (!Object.prototype.hasOwnProperty.call(WRAPPERS, name)) break;
    wrappers.push(name);
    const withValue = WRAPPERS[name];
    k++;
    while (k < w.length && w[k].text.startsWith('-') && w[k].text !== '-') {
      const flag = w[k].text;
      k++;
      if (withValue.has(flag)) k++;
    }
    // timeout takes a duration before the command.
    if (name === 'timeout' && k < w.length && /^\d/.test(w[k].text)) k++;
  }
  return { words: w.slice(k), wrappers };
}
