// The incoming-call popup. The main process sends the call details; the
// buttons send back answer / decline / open / dismiss.
const CALL_WORDS = /(incoming|voice|video)\s+call|calling|huddle|مكالمة|يتصل/i;

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1]?.[0] || '')).toUpperCase();
}

// Services put the caller in the title or the body, and "Incoming call" in
// the other one; show the caller big and the call type small.
function splitCaller(title, body) {
  if (CALL_WORDS.test(title) && body && !CALL_WORDS.test(body)) return { caller: body, kind: title };
  if (CALL_WORDS.test(body) && title && !CALL_WORDS.test(title)) return { caller: title, kind: body };
  return { caller: body || title || 'Incoming call', kind: body ? title : '' };
}

window.call.onShow((info) => {
  const svc = SERVICES[info.service] || SERVICES.whatsapp; // from services.js
  const { caller, kind } = splitCaller(info.title, info.body);
  document.getElementById('caller').textContent = caller;
  document.getElementById('what').textContent = `${kind || 'Incoming call'} · ${svc.fullName || svc.label} — ${info.name}`;
  document.getElementById('avatar').style.background = info.color;
  document.getElementById('initials').textContent = initials(info.name);
  const kindEl = document.getElementById('kind');
  kindEl.style.background = svc.color;
  kindEl.innerHTML = svc.icon; // static SVG from services.js, never from the page
  document.title = `Incoming call: ${caller}`;
  document.getElementById('answer').focus();
});

document.getElementById('answer').onclick = () => window.call.act('answer');
document.getElementById('decline').onclick = () => window.call.act('decline');
document.getElementById('open').onclick = () => window.call.act('open');
document.getElementById('dismiss').onclick = () => window.call.act('dismiss');
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.call.act('dismiss');
});
