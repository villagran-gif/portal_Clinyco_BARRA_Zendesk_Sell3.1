const form = document.getElementById('form');
const rutEl = document.getElementById('rut');
const pipelineIdEl = document.getElementById('pipelineId');
const statusEl = document.getElementById('status');
const outEl = document.getElementById('out');

function setStatus(msg, kind = 'info') {
  statusEl.textContent = msg || '';
  statusEl.className = `status ${kind}`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const rut = rutEl.value;
  const pipelineId = pipelineIdEl.value;

  setStatus('Buscando...', 'info');
  outEl.textContent = '';

  try {
    const res = await fetch('/api/search-rut', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rut, pipelineId }),
    });

    const json = await res.json();
    outEl.textContent = JSON.stringify(json, null, 2);

    if (!res.ok) {
      setStatus(json.message || 'Error', 'error');
    } else {
      setStatus('OK', 'ok');
    }
  } catch (err) {
    setStatus(err.message || String(err), 'error');
  }
});
