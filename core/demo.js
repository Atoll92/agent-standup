// The built-in fictional session (../demo.js: a team fixing a slow login page) as models, so it goes through the same serializers
// as a real session. demo.js is written in the page's format; each line gets a key of its own, and the session never changes,
// so one sequence number covers all of it.
const { deserializeTimeline } = require('./serializers/web');

function demoTimeline() {
  const wire = require('../demo.js')();
  const timeline = deserializeTimeline({ ...wire, events: wire.events.map((event, index) => ({ ...event, k: 'd:' + index })) });
  timeline.feedId = 'demo';
  timeline.sequence = 1;
  return timeline;
}

module.exports = { demoTimeline };
