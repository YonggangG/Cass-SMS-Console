const $ = (id) => document.getElementById(id);
let sims = [];
let messages = [];
let pollTimer = null;

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setStatus(ok, text) {
  const pill = $('statusPill');
  pill.className = 'pill ' + (ok == null ? 'gray' : ok ? 'ok' : 'bad');
  pill.textContent = text;
}

function fmtTime(value) {
  if (!value) return '-';
  const n = Number(value);
  const d = Number.isFinite(n) ? new Date(n) : new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString();
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderSims(status) {
  sims = status?.status?.sims || status?.sims || [];
  $('sim').innerHTML = '';
  if (!sims.length) {
    $('sim').innerHTML = '<option value="-1">默认 SIM（未读取到 SIM/eSIM 列表）</option>';
    return;
  }
  for (const sim of sims) {
    const option = document.createElement('option');
    option.value = sim.subscriptionId;
    option.textContent = `${sim.displayName || 'SIM'} / ${sim.carrierName || ''} (#${sim.subscriptionId})`;
    $('sim').appendChild(option);
  }
}

function renderStatus(data, config) {
  const ok = Boolean(data.ok);
  setStatus(ok, ok ? '手机 Gateway 在线' : '手机 Gateway 离线');
  $('phoneBaseUrl').textContent = config?.phoneBaseUrl || '-';
  $('csvPath').textContent = config?.csvPath || '-';
  $('checkedAt').textContent = fmtTime(data.checkedAt);
  $('messageCount').textContent = data.messageCount ?? data.status?.messageCount ?? '-';
  $('statusDetail').textContent = ok ? JSON.stringify(data.status, null, 2) : (data.error || 'Unknown error');
  renderSims(data);
}

function renderMessages() {
  const q = $('filter').value.trim().toLowerCase();
  const rows = messages.filter(m => !q || [m.direction, m.phone, m.text, m.subscriptionId, m.status].some(v => String(v ?? '').toLowerCase().includes(q)));
  $('messages').innerHTML = rows.map(m => `
    <tr>
      <td>${escapeHtml(fmtTime(m.timestamp))}</td>
      <td><span class="badge">${escapeHtml(m.direction)}</span></td>
      <td>${escapeHtml(m.phone)}</td>
      <td>${escapeHtml(m.subscriptionId)}</td>
      <td>${escapeHtml(m.status)}</td>
      <td class="body">${escapeHtml(m.text)}</td>
    </tr>`).join('') || '<tr><td colspan="6">暂无记录</td></tr>';
}

async function refresh(live = false) {
  const [config, status, msg] = await Promise.all([
    api('/api/config'),
    api('/api/status' + (live ? '?live=1' : '')),
    api('/api/messages')
  ]);
  messages = msg.messages || [];
  renderStatus(status, config);
  renderMessages();
}

async function syncNow() {
  $('syncBtn').disabled = true;
  try {
    await api('/api/sync', { method: 'POST' });
    await refresh(false);
  } catch (err) {
    setStatus(false, '同步失败');
    $('statusDetail').textContent = err.message;
  } finally {
    $('syncBtn').disabled = false;
  }
}

async function sendSms() {
  const payload = {
    to: $('to').value.trim(),
    text: $('text').value,
    subscriptionId: Number($('sim').value)
  };
  if (!payload.to || !payload.text) {
    $('sendResult').textContent = '请填写号码和内容';
    return;
  }
  $('sendBtn').disabled = true;
  $('sendResult').textContent = '发送中...';
  try {
    const result = await api('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    $('sendResult').textContent = result.ok === false ? `失败：${result.error || 'unknown'}` : '已提交发送，并已同步记录';
    $('text').value = '';
    await refresh(true);
  } catch (err) {
    $('sendResult').textContent = `失败：${err.message}`;
  } finally {
    $('sendBtn').disabled = false;
  }
}

$('sendBtn').addEventListener('click', sendSms);
$('syncBtn').addEventListener('click', syncNow);
$('filter').addEventListener('input', renderMessages);

refresh(true).catch(err => {
  setStatus(false, '初始化失败');
  $('statusDetail').textContent = err.message;
});
pollTimer = setInterval(() => refresh(false).catch(() => {}), 3000);
