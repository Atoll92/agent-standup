#!/usr/bin/env node
// Agent Standup: turns Claude Code session transcripts into a replayable "team call" timeline.
// No dependencies. Run: node server.js  → http://localhost:4747
//
// This file puts the server together: the core (core/: sessions → timelines, board, live feed), the services (server/services/:
// pictures, settings, translation, speech, characters), the controllers that answer each address (server/routes.js), and start().
// The command line, the editor extension and the desktop app use what it exports.
const http = require('http');
const kokoro = require('./kokoro.js');   // natural voices, installed on demand (see kokoro.js)
const { createCore, configFromEnv } = require('./core');
const { serializeSessionStatus } = require('./core/serializers/web');
const { createApp } = require('./server/app');
const { ClaudeCli, bundledClaude } = require('./server/services/claudeCli');
const { Translator } = require('./server/services/translator');
const { Speech } = require('./server/services/speech');
const { Pictures } = require('./server/services/pictures');
const { PrefsFile, defaultPrefsPath } = require('./server/services/prefsFile');
const { AudioOwner } = require('./server/services/audioOwner');
const { charactersDir, listCharacters } = require('./server/services/characters');
const { SessionsController } = require('./server/controllers/sessions');
const { PicturesController } = require('./server/controllers/pictures');
const { TranslationController } = require('./server/controllers/translation');
const { VoicesController } = require('./server/controllers/voices');
const { PrefsController } = require('./server/controllers/prefs');
const { CharactersController } = require('./server/controllers/characters');
const { AssetsController } = require('./server/controllers/assets');

const PORT = process.env.PORT || 4747;

// Read from the environment once, when this file is loaded.
const core = createCore(configFromEnv());
const claude = new ClaudeCli();
const translator = new Translator({ claude });
const speech = new Speech({ kokoro });
const prefsFile = new PrefsFile(defaultPrefsPath());

// The board in the names the page reads; the command line, the editor extension and the desktop app show it too.
const boardRows = () => core.boardRows().map(serializeSessionStatus);

const app = createApp({
  sessions: new SessionsController({ core, boardRows }),
  pictures: new PicturesController({ pictures: new Pictures({ core }) }),
  translation: new TranslationController({ translator, claude }),
  voices: new VoicesController({ speech, kokoro, audioOwner: new AudioOwner() }),
  prefs: new PrefsController({ prefsFile }),
  characters: new CharactersController(),
  assets: new AssetsController(),
});

const shutdown = () => { translator.shutdown(); kokoro.shutdown(); };
process.on('exit', shutdown);

function start(port = PORT) {
  return http.createServer(app).listen(port, '127.0.0.1', function () { console.log(`Agent Standup → http://localhost:${this.address().port}`); });
}

module.exports = {
  start, shutdown, boardRows, currentSession: core.currentSession,
  findClaude: () => claude.find(), bundledClaude, charactersDir, listCharacters,
};

if (require.main === module) {
  start().on('error', (error) => {
    console.error(error.code === 'EADDRINUSE' ? `Port ${PORT} is already in use (maybe Agent Standup is already running, e.g. inside VS Code). Try: PORT=4790 node server.js` : String(error));
    process.exit(1);
  });
}
