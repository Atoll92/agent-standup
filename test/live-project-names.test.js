// Project names in real windows, with only synthetic transcripts and isolated preferences.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { tmp, missing, start, session, open } = require('./live-helpers.js');
process.env.AGENT_STANDUP_CODEX = path.join(tmp, 'codex');
process.env.AGENT_STANDUP_VIBE = path.join(tmp, 'vibe');
const A = path.join(tmp, 'work', 'app-old'), B = path.join(tmp, 'work', 'app', 'old');
const raw = (f, r) => fs.appendFileSync(f, JSON.stringify({ timestamp: new Date(Date.now() - 600000).toISOString(), ...r }) + '\n');
const claude = (cwd) => {
  const s = session(), dir = path.join(tmp, 'projects', s.proj);
  raw(path.join(dir, 's.jsonl'), { type: 'user', padding: 'x'.repeat(70000), cwd, message: { role: 'user', content: 'Review this project' } });
  const id = s.launch(1, 'Review', 'Review this project', true);
  fs.writeFileSync(path.join(dir, 's', 'subagents', 'agent-a1.meta.json'), JSON.stringify({ agentType: 'fork', isFork: true, description: 'Review', toolUseId: id }));
  raw(path.join(dir, 's.jsonl'), { type: 'system', cwd: path.join(cwd, 'subdir') });
  s.say('Reviewed.', { sub: 1, end: true }); s.say('All done.', { end: true }); return s;
};
const codex = (id, cwd) => {
  const dir = path.join(process.env.AGENT_STANDUP_CODEX, 'sessions', '2026', '10', '27'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'rollout-2026-10-27T10-00-00-' + id + '.jsonl');
  raw(f, { type: 'session_meta', payload: { id, cwd, source: 'cli' } });
  raw(f, { type: 'event_msg', payload: { type: 'user_message', message: 'Review the project' } });
  raw(f, { type: 'event_msg', payload: { type: 'agent_message', message: 'All done.' } }); return id;
};
const vibe = (id, cwd) => {
  const dir = path.join(process.env.AGENT_STANDUP_VIBE, 'logs', 'session', id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ session_id: id, start_time: new Date().toISOString(), environment: { working_directory: cwd } }));
  fs.writeFileSync(path.join(dir, 'messages.jsonl'), JSON.stringify({ role: 'user', content: 'Review the project' }) + '\n' + JSON.stringify({ role: 'assistant', content: 'All done.' }) + '\n'); return id;
};
const edit = (c, field, value) => c.page.evaluate(async ({ field, value }) => {
  const el = document.getElementById(field); el.value = value; el.dispatchEvent(new Event('input')); el.dispatchEvent(new Event('change'));
  clearTimeout(prefsTimer); await putPrefs(); return leadName();
}, { field, value });
const named = (c) => c.page.evaluate(() => [S.agents.main.name, S.agents.a1 && S.agents.a1.name, document.querySelector('#t-main .tag b').textContent]);
const reload = async (c) => { await c.page.evaluate(() => localStorage.removeItem('cc.prefs')); await c.page.reload(); await c.until(() => typeof S !== 'undefined' && S.cur); };

test('project lead names: folders, windows, switching and fallback', { skip: missing || false, timeout: 90000 }, async (t) => {
  const a = claude(A), b = claude(B), same = claude(A);
  const legacy = session(); legacy.user('An old transcript'); legacy.say('Done.', { end: true });
  const unknown = codex('01a00000-0000-7000-8000-00000000000c', '');
  const ca = codex('01a00000-0000-7000-8000-00000000000a', A), cb = codex('01a00000-0000-7000-8000-00000000000b', B);
  const va = vibe('session_20261027_100000_aaaa1111', A), vb = vibe('session_20261027_110000_bbbb2222', B);
  await start(t);
  const c = await open(a, false), other = await open(b, false);   // both opened before either name is saved
  await c.page.setViewport({ width: 1280, height: 900 });
  const saved = () => JSON.parse(fs.readFileSync(process.env.AGENT_STANDUP_PREFS, 'utf8'));
  const ka = 'leadName:cwd:' + A, kb = 'leadName:cwd:' + B;

  await t.test('two stale windows save different project names without losing either', async () => {
    assert.equal(await edit(c, 'leadName', 'Default'), 'Default');
    assert.equal(await edit(c, 'projectLeadName', 'Nova'), 'Nova');
    assert.equal(await edit(other, 'projectLeadName', 'Orion'), 'Orion');
    assert.deepEqual([saved()[ka], saved()[kb], saved().leadName], ['Nova', 'Orion', 'Default']);
    await reload(c); await reload(other);
    assert.deepEqual(await named(c), ['Nova', 'Nova 2', 'Nova']); assert.deepEqual(await named(other), ['Orion', 'Orion 2', 'Orion']);
    assert.equal(await c.page.evaluate(() => document.querySelector('#projectLeadName').value), 'Nova');
    await c.page.evaluate(() => { renderLog(true); paintStates(); });
    assert.match(await c.page.$eval('#log', (el) => el.textContent), /Nova/);
    assert.match(await c.page.$eval('#roster', (el) => el.textContent), /Nova/);
  });

  await t.test('live and replay switching use the actual folder, including two projects in each provider bucket', async (t) => {
    t.after(async () => {   // later name-editing tests need project A even if a switching assertion fails
      await c.page.evaluate(() => setMode('replay'));
      await c.page.select('#sessions', a.proj + '|s'); await c.until((proj) => S.cur && S.cur.proj === proj && S.cur.id === 's', a.proj);
    });
    await c.page.evaluate(() => { openPrefs(document.querySelector('#projectLeadBox')); document.querySelector('#projectLeadName').focus(); });
    await c.page.evaluate(({ proj }) => { Q.delete('proj'); return openSession(proj, 's'); }, b);
    // A concurrent poll can supersede openSession's load and finish after its promise resolves.
    await c.until((proj) => S.cur && S.cur.proj === proj && S.cur.id === 's', b.proj);
    assert.equal(await c.page.evaluate(() => document.querySelector('#projectLeadName').value), 'Orion', 'switching replaces a focused field from the old project');
    assert.deepEqual(await named(c), ['Orion', 'Orion 2', 'Orion']);
    await c.page.evaluate(() => setMode('replay'));
    for (const [proj, id, want] of [[a.proj, 's', 'Nova'], [same.proj, 's', 'Nova'], ['_codex', ca, 'Nova'], ['_codex', cb, 'Orion'], ['_vibe', va, 'Nova'], ['_vibe', vb, 'Orion']]) {
      await c.page.select('#sessions', proj + '|' + id); await c.until(({ proj, id }) => S.cur && S.cur.proj === proj && S.cur.id === id, { proj, id });
      assert.equal(await c.page.evaluate(() => S.agents.main.name), want, proj + '/' + id);
    }
  });

  await t.test('project names retain sanitization, Unicode, fork and collision rules', async () => {
    assert.equal(await edit(c, 'projectLeadName', 'Captain <Hook> & Co'), 'Captain Hook Co');
    assert.deepEqual(await named(c), ['Captain Hook Co', 'Captain Hook Co 2', 'Captain Hook Co']);
    assert.equal(await edit(c, 'projectLeadName', '🙂'.repeat(25)), '🙂'.repeat(24));
    assert.equal(await c.page.evaluate(() => document.querySelector('#projectLeadName').maxLength), 48);
    await c.page.evaluate(() => { S.agents.a2 = persona({ id: 'a2', own: 'NOVA', type: 'reviewer' }); buildStage(); });
    await edit(c, 'projectLeadName', 'Nova');
    assert.notEqual(await c.page.evaluate(() => S.agents.a2.name.toLowerCase()), 'nova');
    assert.equal(await c.page.evaluate(() => { const saved = { ...nameBook }; NAMES.forEach((n, i) => { nameBook['x' + i] = n; }); const key = projectLeadKey(), old = prefs[key]; prefs[key] = NAMES[5]; const n = uniqueName('overflow', 5); prefs[key] = old; for (const k in nameBook) delete nameBook[k]; Object.assign(nameBook, saved); return n.startsWith(NAMES[5] + ' '); }), false);
    await edit(c, 'projectLeadName', '');
    assert.equal(await c.page.evaluate(() => S.agents.a2.name), 'NOVA', 'clearing restores a custom name that collided');
    assert.equal(saved()[ka], undefined); assert.equal(saved()[kb], 'Orion');
    assert.equal(await c.page.evaluate(() => leadName()), 'Default');
  });

  await t.test('editor wins, clearing falls back, and demo or an older server cannot create a bucket name', async () => {
    await edit(c, 'projectLeadName', 'Nova');
    assert.deepEqual(await c.page.evaluate(() => { APP.lead = 'Editor'; leadField(); renameLead(); return [leadName(), document.querySelector('#leadName').disabled, document.querySelector('#projectLeadName').disabled, S.agents.a1.name]; }), ['Editor', true, true, 'Editor 2']);
    await c.page.evaluate(() => { APP.lead = ''; leadField(); renameLead(); });
    assert.equal(await c.page.evaluate(() => leadName()), 'Nova');
    await edit(c, 'projectLeadName', ''); await edit(c, 'leadName', '');
    assert.deepEqual(await named(c), ['Margot', 'Margot 2', 'Margot']);
    await c.page.evaluate(({ proj }) => loadSession(proj, 's'), legacy);
    assert.equal(await c.page.evaluate(() => projectLeadKey()), 'leadName:claude:' + legacy.proj, 'older Claude transcripts retain their project folder');
    await c.page.evaluate((id) => loadSession('_codex', id), unknown);
    assert.equal(await c.page.evaluate(() => document.querySelector('#projectLeadName').disabled), true, 'a provider without a folder cannot save a provider-wide name');
    await c.page.evaluate(() => setMode('demo'));
    assert.deepEqual(await c.page.evaluate(() => [leadName(), projectLeadKey(), document.querySelector('#projectLeadName').disabled]), ['Margot', '', true]);
    await c.page.evaluate(async ({ proj }) => { const f = window.fetch; window.fetch = async (...args) => { const r = await f(...args); if (!String(args[0]).startsWith('/api/session?')) return r; const d = await r.json(); delete d.project; return new Response(JSON.stringify(d)); }; try { await loadSession(proj, 's'); } finally { window.fetch = f; } }, a);
    assert.equal(await c.page.evaluate(() => document.querySelector('#projectLeadName').disabled), true);
  });

  await t.test('reset clears the global and displayed project name, preserving other projects', async () => {
    await c.page.evaluate(async ({ proj }) => { S.demo = false; S.live = false; await loadSession(proj, 's'); }, a);
    await edit(c, 'leadName', 'Default'); await edit(c, 'projectLeadName', 'Nova');
    await Promise.all([c.page.waitForNavigation({ waitUntil: 'load' }), c.page.evaluate(() => { document.querySelector('#prefsReset').click(); document.querySelector('#prefsReset').click(); })]); await c.until(() => typeof S !== 'undefined' && S.cur);
    assert.deepEqual([saved()[ka], saved()[kb], saved().leadName], [undefined, 'Orion', undefined]);
  });
  await c.close(); await other.close();

  await t.test('a late cwd refreshes the live project, including a metadata-only update, and subsequent edits survive reload', async () => {
    for (const type of ['user', 'system']) {
      const s = session(), file = path.join(tmp, 'projects', s.proj, 's.jsonl'), cwd = path.join(tmp, 'late-' + type), key = 'leadName:cwd:' + cwd;
      raw(file, { type: 'queue-operation' });
      fs.writeFileSync(process.env.AGENT_STANDUP_PREFS, JSON.stringify({ ...saved(), [key]: 'Nova', _t: Date.now() }));
      const live = await open(s, false);
      try {
        assert.equal(await live.page.evaluate(() => projectLeadKey()), 'leadName:claude:' + s.proj);
        await live.page.evaluate(() => openPrefs(document.querySelector('#projectLeadBox')));
        raw(file, { type, cwd, ...(type === 'user' ? { message: { role: 'user', content: 'The first prompt with a project folder' } } : {}) });
        if (type === 'user') await live.until(() => S.events.some((e) => e.text === 'The first prompt with a project folder'));
        else await live.until((key) => projectLeadKey() === key, key, 5000);   // metadata can change while the timeline's sequence number stays the same
        assert.deepEqual(await live.page.evaluate(() => [projectLeadKey(), S.agents.main.name, document.querySelector('#projectLeadName').value]), [key, 'Nova', 'Nova']);
        assert.equal(await edit(live, 'projectLeadName', 'Stella'), 'Stella');
        assert.equal(saved()[key], 'Stella'); assert.equal(saved()['leadName:claude:' + s.proj], undefined);
        await reload(live);
        assert.deepEqual(await live.page.evaluate(() => [projectLeadKey(), S.agents.main.name, document.querySelector('#projectLeadName').value]), [key, 'Stella', 'Stella']);
      } finally { await live.close(); }
    }
  });
});
