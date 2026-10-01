/* Minimal GitHub REST client — reads and commits files straight from the browser. */
(function () {
  'use strict';
  var C = window.ADMIN_CONFIG;

  function GH(token) { this.token = token; }

  GH.prototype.req = function (method, path, body) {
    var self = this;
    return fetch(C.apiBase + path, {
      method: method,
      cache: 'no-store',
      headers: {
        Authorization: 'Bearer ' + self.token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null;
        try { j = t ? JSON.parse(t) : null; } catch (e) { /* not JSON */ }
        if (!r.ok) {
          var err = new Error((j && j.message) || ('HTTP ' + r.status));
          err.status = r.status;
          throw err;
        }
        return j;
      });
    });
  };

  var enc = encodeURIComponent;
  function repo() { return '/repos/' + C.repo; }

  function decodeB64(b64) {
    var bin = atob(b64.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, function (c) { return c.charCodeAt(0); }));
  }

  /** Verifies the token and that it can write to the repository. */
  GH.prototype.check = function () {
    return this.req('GET', repo()).then(function (r) {
      if (!r.permissions || !r.permissions.push) {
        var e = new Error('no-write'); e.status = 403; throw e;
      }
      return r;
    });
  };

  /** Reads a text file at a ref. Resolves {text, sha} or null if it does not exist. */
  GH.prototype.readFile = function (path, ref) {
    return this.req('GET', repo() + '/contents/' + path.split('/').map(enc).join('/') + '?ref=' + enc(ref || C.branch))
      .then(function (r) { return { text: decodeB64(r.content), sha: r.sha }; })
      .catch(function (e) { if (e.status === 404) return null; throw e; });
  };

  /** Atomic commit of several files. files: [{path, text} | {path, base64}] */
  GH.prototype.commit = function (files, message) {
    var self = this;
    var branch = C.branch;
    return self.req('GET', repo() + '/git/ref/heads/' + enc(branch)).then(function (ref) {
      var headSha = ref.object.sha;
      return self.req('GET', repo() + '/git/commits/' + headSha).then(function (head) {
        return Promise.all(files.map(function (f) {
          return self.req('POST', repo() + '/git/blobs', f.base64 != null
            ? { content: f.base64, encoding: 'base64' }
            : { content: f.text, encoding: 'utf-8' });
        })).then(function (blobs) {
          var blobShas = {};
          files.forEach(function (f, i) { blobShas[f.path] = blobs[i].sha; });
          return self.req('POST', repo() + '/git/trees', {
            base_tree: head.tree.sha,
            tree: files.map(function (f, i) { return { path: f.path, mode: '100644', type: 'blob', sha: blobs[i].sha }; })
          }).then(function (tree) {
            return self.req('POST', repo() + '/git/commits', { message: message, tree: tree.sha, parents: [headSha] });
          }).then(function (commit) {
            return self.req('PATCH', repo() + '/git/refs/heads/' + enc(branch), { sha: commit.sha })
              .then(function () { return { commit: commit.sha, blobs: blobShas }; });
          });
        });
      });
    });
  };

  /** Recent commits that touched a file. */
  GH.prototype.history = function (path, n) {
    return this.req('GET', repo() + '/commits?sha=' + enc(C.branch) + '&path=' + enc(path) + '&per_page=' + (n || 20));
  };

  window.GH = GH;
})();
