// Penyimpanan dalam memori: objek git kanonik, referensi, issue, dan pull request.
import {createHash} from 'node:crypto';

export const viewer = {login: 'adaiversen', id: 1, type: 'User'};
export const zero = '0'.repeat(40);

export const digest = (data) => createHash('sha1').update(data).digest('hex');

export class Failure extends Error {
  status;
  constructor(status, message) {
    super(message);
    this.name = 'Failure';
    this.status = status;
  }
}

export function fail(status, message) {
  throw new Failure(status, message);
}

const stamp = () => new Date().toISOString();
const isSha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value);

function signature(raw) {
  const matched = raw.match(/^(.*?)\s*<([^>]*)>\s*(\d+)\s*[+-]\d{4}$/);
  if (!matched) return {name: raw.trim(), email: '', date: '0'};
  return {name: matched[1].trim(), email: matched[2], date: matched[3]};
}

function commitText(commit) {
  const author = commit.author || {name: viewer.login, email: '', date: '0'};
  const committer = commit.committer || author;
  const lines = ['tree ' + commit.tree];
  for (const parent of commit.parents || []) lines.push('parent ' + parent);
  lines.push('author ' + author.name + ' <' + author.email + '> ' + author.date + ' +0000');
  lines.push('committer ' + committer.name + ' <' + committer.email + '> ' + committer.date + ' +0000');
  lines.push('', commit.message || '');
  return lines.join('\n') + '\n';
}

function readCommit(buffer) {
  const text = buffer.toString('utf8');
  const cut = text.indexOf('\n\n');
  const head = cut < 0 ? text : text.slice(0, cut);
  const body = cut < 0 ? '' : text.slice(cut + 2);
  const parsed = {tree: '', parents: [], author: null, committer: null, message: body};
  for (const line of head.split('\n')) {
    if (line.startsWith('tree ')) parsed.tree = line.slice(5);
    else if (line.startsWith('parent ')) parsed.parents.push(line.slice(7));
    else if (line.startsWith('author ')) parsed.author = signature(line.slice(7));
    else if (line.startsWith('committer ')) parsed.committer = signature(line.slice(10));
  }
  return parsed;
}

export class Store {
  repos = new Map();
  objects = new Map();
  ids = new Map();
  serial = 1;

  id(type, key = String(this.serial)) {
    return Buffer.from(type + ':' + key, 'utf8').toString('base64url');
  }

  put(type, data) {
    let buffer;
    if (Buffer.isBuffer(data)) buffer = data;
    else if (type === 'commit') buffer = Buffer.from(commitText(data));
    else if (typeof data === 'string') buffer = Buffer.from(data, 'utf8');
    else buffer = Buffer.from(JSON.stringify(data), 'utf8');
    const header = Buffer.from(type + ' ' + buffer.length + '\0');
    const sha = digest(Buffer.concat([header, buffer]));
    let value;
    if (type === 'commit') value = Buffer.isBuffer(data) ? readCommit(buffer) : {...data};
    else if (type === 'tree') value = buffer;
    else value = Buffer.isBuffer(data) ? buffer.toString('utf8') : data;
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) value.sha = sha;
    this.objects.set(sha, {type, data: buffer, value});
    return sha;
  }

  repo(owner, name) {
    const who = typeof owner === 'string' ? owner : owner && owner.login;
    const r = this.repos.get(who + '/' + name);
    if (!r) fail(404, 'Not Found');
    return r;
  }

  create(x = {}) {
    if (!x.name || typeof x.name !== 'string' || !x.name.trim()) fail(422, 'name missing');
    const fullName = viewer.login + '/' + x.name;
    if (this.repos.has(fullName)) fail(422, 'repository exists');
    const now = stamp();
    const r = {
      id: this.serial++,
      node_id: this.id('Repository', fullName),
      name: x.name,
      full_name: fullName,
      owner: viewer,
      description: x.description || '',
      private: !!x.private,
      default_branch: x.default_branch || 'main',
      refs: {},
      issues: [],
      pulls: [],
      labels: [],
      created_at: now,
      updated_at: now,
      pushed_at: null,
    };
    this.repos.set(fullName, r);
    this.ids.set(r.node_id, {r, item: r, kind: 'Repository'});
    if (x.auto_init) this.write(r, x.files || {'README.md': '# ' + r.name + '\n'}, 'initial commit');
    return r;
  }

  view(r) {
    return {
      id: r.id,
      node_id: r.node_id,
      name: r.name,
      full_name: r.full_name,
      owner: r.owner,
      private: r.private,
      description: r.description,
      default_branch: r.default_branch,
      html_url: 'https://github.com/' + r.full_name,
      clone_url: 'https://github.com/' + r.full_name + '.git',
      ssh_url: 'git@github.com:' + r.full_name + '.git',
      size: Object.keys(this.files(this.tip(r))).length,
      open_issues_count: r.issues.filter((i) => i.state === 'open').length,
      fork: false,
      archived: false,
      disabled: false,
      created_at: r.created_at,
      updated_at: r.updated_at,
      pushed_at: r.pushed_at,
    };
  }

  tip(r, ref) {
    const wanted = ref || r.default_branch;
    if (isSha(wanted) && this.objects.has(wanted)) return wanted;
    return r.refs[wanted] || r.refs['refs/heads/' + wanted] || r.refs['refs/tags/' + wanted] || null;
  }

  commit(sha) {
    const object = this.objects.get(sha);
    if (!object || object.type !== 'commit') return null;
    if (!object.value) object.value = readCommit(object.data);
    return object.value;
  }

  tree(sha, prefix = '', out = []) {
    if (!sha) return out;
    const root = this.objects.get(sha);
    if (!root) return out;
    let treeSha = sha;
    if (root.type === 'commit') {
      const commit = this.commit(sha);
      if (!commit) return out;
      treeSha = commit.tree;
    }
    const tree = this.objects.get(treeSha);
    if (!tree || tree.type !== 'tree') return out;
    const raw = tree.data;
    let at = 0;
    while (at < raw.length) {
      const nul = raw.indexOf(0, at);
      if (nul < 0) break;
      const heading = raw.subarray(at, nul).toString('utf8');
      const space = heading.indexOf(' ');
      const mode = space < 0 ? '100644' : heading.slice(0, space);
      const name = space < 0 ? heading : heading.slice(space + 1);
      const child = raw.subarray(nul + 1, nul + 21).toString('hex');
      const path = prefix ? prefix + '/' + name : name;
      if (mode === '40000' || mode === '040000') this.tree(child, path, out);
      else {
        const blob = this.objects.get(child);
        out.push({path, mode, type: 'blob', sha: child, size: blob ? blob.data.length : 0});
      }
      at = nul + 21;
    }
    return out;
  }

  files(sha) {
    const result = {};
    if (!sha || !this.objects.has(sha)) return result;
    for (const entry of this.tree(sha)) {
      const blob = this.objects.get(entry.sha);
      result[entry.path] = blob ? String(blob.value === undefined ? blob.data.toString('utf8') : blob.value) : '';
    }
    return result;
  }

  buildTree(files) {
    const root = [];
    for (const [path, content] of Object.entries(files || {})) {
      const parts = String(path).split('/').filter(Boolean);
      if (!parts.length) continue;
      let level = root;
      for (let i = 0; i < parts.length - 1; i++) {
        let folder = level.find((entry) => entry.folder && entry.name === parts[i]);
        if (!folder) {
          folder = {folder: true, name: parts[i], children: []};
          level.push(folder);
        }
        level = folder.children;
      }
      const sha = this.put('blob', content === null || content === undefined ? '' : String(content));
      level.push({folder: false, name: parts[parts.length - 1], sha, mode: '100644'});
    }
    const seal = (level) => {
      const chunks = [];
      for (const entry of [...level].sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.folder) {
          const sha = seal(entry.children);
          chunks.push(Buffer.from('40000 ' + entry.name + '\0', 'utf8'), Buffer.from(sha, 'hex'));
        } else {
          chunks.push(Buffer.from(entry.mode + ' ' + entry.name + '\0', 'utf8'), Buffer.from(entry.sha, 'hex'));
        }
      }
      return this.put('tree', Buffer.concat(chunks));
    };
    return seal(root);
  }

  write(r, files = {}, message = 'update', parents, ref) {
    const tree = this.buildTree(files);
    const inherited = parents === undefined || parents === null
      ? [this.tip(r, ref)].filter(Boolean)
      : (Array.isArray(parents) ? parents : [parents]).filter(Boolean);
    const when = String(Math.floor(Date.now() / 1000));
    const who = {name: viewer.login, email: viewer.login + '@users.noreply.github.com', date: when};
    const sha = this.put('commit', {tree, parents: inherited, author: who, committer: who, message});
    r.refs['refs/heads/' + (ref || r.default_branch)] = sha;
    r.updated_at = stamp();
    r.pushed_at = r.updated_at;
    return {...this.commit(sha), sha, tree};
  }

  content(r, path, ref) {
    const clean = String(path).replace(/^\/+/, '');
    const data = this.files(this.tip(r, ref))[clean];
    if (data === undefined) fail(404, 'Not Found');
    const blobSha = this.put('blob', data);
    const at = ref || r.default_branch;
    return {
      type: 'file',
      name: clean.split('/').pop(),
      path: clean,
      sha: blobSha,
      size: Buffer.byteLength(data),
      encoding: 'base64',
      content: Buffer.from(data, 'utf8').toString('base64'),
      url: 'https://api.github.com/repos/' + r.full_name + '/contents/' + clean,
      html_url: 'https://github.com/' + r.full_name + '/blob/' + at + '/' + clean,
      download_url: 'https://raw.githubusercontent.com/' + r.full_name + '/' + at + '/' + clean,
      git_url: 'https://api.github.com/repos/' + r.full_name + '/git/blobs/' + blobSha,
      _data: data,
    };
  }

  updateContent(r, path, x = {}, remove = false) {
    const ref = x.branch || r.default_branch;
    const files = this.files(this.tip(r, ref));
    const clean = String(path).replace(/^\/+/, '');
    const previous = Object.prototype.hasOwnProperty.call(files, clean) ? files[clean] : undefined;
    if (x.sha) {
      const expected = this.objects.get(x.sha);
      const text = expected ? String(expected.value === undefined ? expected.data.toString('utf8') : expected.value) : null;
      if (text !== previous) fail(409, 'sha mismatch');
    }
    if (remove) {
      if (previous === undefined) fail(404, 'Not Found');
      delete files[clean];
    } else {
      if (typeof x.content !== 'string') fail(422, 'content required');
      files[clean] = Buffer.from(x.content, x.encoding === 'base64' ? 'base64' : 'utf8').toString('utf8');
    }
    const parent = this.tip(r, ref);
    const commit = this.write(r, files, x.message || (remove ? 'Delete ' : 'Update ') + clean, parent ? [parent] : [], ref);
    const payload = {content: remove ? null : this.content(r, clean, ref), commit};
    return {body: payload, ...payload};
  }

  issue(r, x = {}) {
    if (!x.title) fail(422, 'title required');
    const number = this.serial++;
    const now = stamp();
    const item = {
      id: number,
      node_id: this.id('Issue', r.full_name + '#' + number),
      number,
      title: x.title,
      body: x.body || '',
      state: x.state || 'open',
      labels: x.labels || [],
      user: viewer,
      author: viewer,
      comments: [],
      _comments: [],
      _repo: r.full_name,
      __kind: 'Issue',
      created_at: now,
      updated_at: now,
    };
    r.issues.push(item);
    this.ids.set(item.node_id, {r, item, kind: 'Issue'});
    return item;
  }

  comment(item, x = {}) {
    if (!x.body) fail(422, 'body required');
    const id = this.serial++;
    const now = stamp();
    const note = {
      id,
      node_id: this.id('IssueComment', (item._repo || '') + '#C' + id),
      body: x.body,
      user: viewer,
      author: viewer,
      created_at: now,
      updated_at: now,
      __kind: 'IssueComment',
    };
    item._comments = item._comments || [];
    item.comments = item.comments || [];
    item._comments.push(note);
    item.comments.push(note);
    item.updated_at = now;
    const r = this.repos.get(item._repo) || null;
    this.ids.set(note.node_id, {r, item: note, kind: 'IssueComment'});
    return note;
  }

  refPart(value) {
    if (typeof value === 'string') return {ref: value, sha: null};
    if (!value) return {ref: '', sha: null};
    return {ref: value.ref || value.head || value.branch || '', sha: value.sha || null};
  }

  branchName(ref) {
    const text = String(ref || '');
    return text.includes(':') ? text.split(':').pop() : text;
  }

  pull(r, x = {}) {
    if (!x.title) fail(422, 'title required');
    const head = this.refPart(x.head);
    const base = this.refPart(x.base);
    if (!head.ref || !base.ref) fail(422, 'head and base required');
    const number = this.serial++;
    const now = stamp();
    const item = {
      id: number,
      node_id: this.id('PullRequest', r.full_name + '#P' + number),
      number,
      title: x.title,
      body: x.body || '',
      state: 'open',
      merged: false,
      mergeable: true,
      user: viewer,
      author: viewer,
      head: {...head, ref: head.ref, sha: head.sha || this.tip(r, this.branchName(head.ref)) || zero, repo: (x.head && x.head.repo) || r.full_name},
      base: {...base, ref: base.ref, sha: base.sha || this.tip(r, this.branchName(base.ref)) || zero, repo: (x.base && x.base.repo) || r.full_name},
      comments: [],
      _comments: [],
      _repo: r.full_name,
      __kind: 'PullRequest',
      changed_files: 0,
      commits: 0,
      created_at: now,
      updated_at: now,
    };
    r.pulls.push(item);
    this.ids.set(item.node_id, {r, item, kind: 'PullRequest'});
    return item;
  }

  ancestor(a, b) {
    if (!a || a === zero) return true;
    if (!b || b === zero) return false;
    if (a === b) return true;
    const seen = new Set();
    const stack = [b];
    while (stack.length) {
      const current = stack.pop();
      if (current === a) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      const commit = this.commit(current);
      if (commit) for (const parent of commit.parents || []) stack.push(parent);
    }
    return false;
  }

  common(a, b) {
    const first = new Set();
    let seen = new Set();
    let stack = [a];
    while (stack.length) {
      const current = stack.pop();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      first.add(current);
      const commit = this.commit(current);
      if (commit) for (const parent of commit.parents || []) stack.push(parent);
    }
    seen = new Set();
    stack = [b];
    while (stack.length) {
      const current = stack.pop();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      if (first.has(current)) return current;
      const commit = this.commit(current);
      if (commit) for (const parent of commit.parents || []) stack.push(parent);
    }
    return null;
  }

  resolveRef(value) {
    if (!value) return null;
    if (typeof value === 'string') return this.objects.has(value) ? value : null;
    if (value.sha && this.objects.has(value.sha)) return value.sha;
    return null;
  }

  changes(p) {
    if (!p) return [];
    const base = this.files(this.resolveRef(p.base));
    const head = this.files(this.resolveRef(p.head));
    const names = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort();
    return names.map((filename) => {
      const before = base[filename];
      const after = head[filename];
      const status = before === undefined ? 'added' : after === undefined ? 'removed' : 'modified';
      const additions = after === undefined ? 0 : String(after).split('\n').length;
      const deletions = before === undefined ? 0 : String(before).split('\n').length;
      const patch = status === 'removed' ? '' : '--- a/' + filename + '\n+++ b/' + filename + '\n';
      return {filename, status, additions, deletions, changes: additions + deletions, patch};
    });
  }

  merge(r, p) {
    // Semua pemeriksaan konflik dilakukan sebelum write agar ref tetap atomic.
    if (!p) fail(404, 'Not Found');
    if (p.merged) fail(422, 'Pull request already merged');
    const ours = r.refs['refs/heads/' + (p.base && p.base.ref || r.default_branch)] || this.tip(r);
    const theirs = this.resolveRef(p.head);
    if (!theirs) fail(422, 'Missing head commit');
    if (this.ancestor(theirs, ours)) {
      p.state = 'closed';
      p.merged = true;
      p.merge_commit_sha = ours;
      return {sha: ours, merged: true, message: 'Already up to date.'};
    }
    const found = this.common(ours, theirs);
    const base = this.files(found);
    const left = this.files(ours);
    const right = this.files(theirs);
    const combined = {...base};
    for (const [path, value] of Object.entries(right)) {
      const inBase = Object.prototype.hasOwnProperty.call(base, path);
      const leftChanged = Object.prototype.hasOwnProperty.call(left, path) && left[path] !== base[path];
      const rightChanged = !inBase || value !== base[path];
      if (inBase && leftChanged && rightChanged && left[path] !== value) fail(409, 'merge conflict');
      combined[path] = value;
    }
    for (const path of Object.keys(base)) {
      if (!Object.prototype.hasOwnProperty.call(right, path) && left[path] !== base[path]) fail(409, 'merge conflict');
      if (!Object.prototype.hasOwnProperty.call(right, path)) delete combined[path];
    }
    const commit = this.write(r, combined, 'Merge pull request #' + p.number + ' from ' + (p.head && p.head.ref || ''), [ours, theirs], p.base && p.base.ref);
    p.state = 'closed';
    p.merged = true;
    p.merge_commit_sha = commit.sha;
    p.changed_files = this.changes(p).length;
    return {...commit, merged: true, message: 'ok'};
  }

  byId(id) {
    if (this.ids.has(id)) return this.ids.get(id);
    const absent = {r: null, item: null, kind: null};
    let raw;
    try {
      raw = Buffer.from(String(id), 'base64url').toString('utf8');
    } catch {
      return absent;
    }
    const colon = raw.indexOf(':');
    if (colon < 0) return absent;
    const kind = raw.slice(0, colon);
    const key = raw.slice(colon + 1);
    if (kind === 'Repository') {
      const r = this.repos.get(key);
      return r ? {r, item: r, kind} : absent;
    }
    for (const r of this.repos.values()) {
      for (const item of r.issues) if (item.node_id === id) return {r, item, kind: 'Issue'};
      for (const item of r.pulls) if (item.node_id === id) return {r, item, kind: 'PullRequest'};
    }
    return absent;
  }
}
