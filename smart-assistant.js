'use strict';

(() => {
  if (document.getElementById('smartBriefingCard')) return;

  const SMART_VERSION = 1;
  const CADENCES = [0, 7, 15, 30];
  const LEAD_DAYS = [0, 1, 3, 7];
  const FILTERS = [
    ['all', 'Todos'],
    ['overdue', 'Vencidos'],
    ['today', 'Hoje'],
    ['week', 'Próximos 7 dias']
  ];

  const SMART_ICONS = {
    brain: '<path d="M9.5 4.5A3 3 0 0 0 4 6a3 3 0 0 0 .6 1.8A3.5 3.5 0 0 0 5.5 14a3.5 3.5 0 0 0 4 5.5V4.5ZM14.5 4.5A3 3 0 0 1 20 6a3 3 0 0 1-.6 1.8 3.5 3.5 0 0 1-.9 6.2 3.5 3.5 0 0 1-4 5.5V4.5Z"/><path d="M9.5 9A2.5 2.5 0 0 1 7 6.5M14.5 9A2.5 2.5 0 0 0 17 6.5M9.5 14a3 3 0 0 0-3 3M14.5 14a3 3 0 0 1 3 3"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
  };

  function smartIcon(name) {
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + SMART_ICONS[name] + '</svg>';
  }

  function validDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value + 'T12:00:00Z'));
  }

  function shiftDate(value, amount) {
    const date = new Date(value + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + Number(amount || 0));
    return date.toISOString().slice(0, 10);
  }

  function dayDistance(from, to) {
    return Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000);
  }

  function openAccountStage(account) {
    return !String(account.stage || '').startsWith('Fechado');
  }

  function cleanNumber(value, allowed, fallback) {
    const number = Number(value);
    return allowed.includes(number) ? number : fallback;
  }

  function defaultSmartSettings() {
    return {
      version: SMART_VERSION,
      defaultCadenceDays: 15,
      notificationLeadDays: 1,
      notificationHour: '08:00',
      discreetNotifications: true,
      notificationsEnabled: false,
      deviceId: '',
      deviceSecret: '',
      lastScheduleSync: ''
    };
  }

  function normalizeSmartState(source) {
    const defaults = defaultSmartSettings();
    source.smartSettings = {...defaults, ...(source.smartSettings || {})};
    source.smartSettings.version = SMART_VERSION;
    source.smartSettings.defaultCadenceDays = cleanNumber(source.smartSettings.defaultCadenceDays, CADENCES, 15);
    source.smartSettings.notificationLeadDays = cleanNumber(source.smartSettings.notificationLeadDays, LEAD_DAYS, 1);
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(source.smartSettings.notificationHour || '')) source.smartSettings.notificationHour = '08:00';
    source.smartSettings.discreetNotifications = source.smartSettings.discreetNotifications !== false;
    source.smartSettings.notificationsEnabled = source.smartSettings.notificationsEnabled === true;
    source.reminderHistory = Array.isArray(source.reminderHistory) ? source.reminderHistory.slice(-160) : [];
    source.notificationLog = source.notificationLog && typeof source.notificationLog === 'object' ? source.notificationLog : {};
    source.accounts = (source.accounts || []).map(account => {
      const reminder = account.reminder && typeof account.reminder === 'object' ? account.reminder : {};
      return {
        ...account,
        reminder: {
          enabled: reminder.enabled !== false,
          cadenceDays: cleanNumber(reminder.cadenceDays, CADENCES, account.elite ? 15 : source.smartSettings.defaultCadenceDays),
          leadDays: cleanNumber(reminder.leadDays, LEAD_DAYS, source.smartSettings.notificationLeadDays)
        }
      };
    });
    source.schemaVersion = Math.max(7, Number(source.schemaVersion) || 0);
    return source;
  }

  const normalizeBeforeSmart = normalizeV3;
  normalizeV3 = function(source) {
    return normalizeSmartState(normalizeBeforeSmart(source));
  };

  state = normalizeV3(state);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (error) {}

  let agendaFilter = 'all';
  let notificationBusy = false;
  let cloudSyncTimer = 0;

  function reminderDate(account) {
    if (validDate(account.nextDate)) return account.nextDate;
    if (account.elite && validDate(account.lastVisit)) {
      return shiftDate(account.lastVisit, cleanNumber(account.reminder?.cadenceDays, CADENCES, 15) || 15);
    }
    return '';
  }

  function reminderLead(account) {
    return cleanNumber(account.reminder?.leadDays, LEAD_DAYS, state.smartSettings.notificationLeadDays);
  }

  function accountPriority(account) {
    const dueDate = reminderDate(account);
    const distance = dueDate ? dayDistance(todayISO(), dueDate) : null;
    const reasons = [];
    let points = 0;

    if (distance !== null && distance < 0) {
      points += 70 + Math.min(25, Math.abs(distance));
      reasons.push('retorno vencido há ' + Math.abs(distance) + (Math.abs(distance) === 1 ? ' dia' : ' dias'));
    } else if (distance === 0) {
      points += 65;
      reasons.push('retorno marcado para hoje');
    } else if (distance !== null && distance <= 3) {
      points += 42 - distance * 3;
      reasons.push('retorno próximo');
    } else if (distance !== null && distance <= 7) {
      points += 24;
      reasons.push('ação nesta semana');
    }

    if (account.priority === 'A') {
      points += 34;
      reasons.push('classe A');
    } else if (account.priority === 'B') points += 17;

    if (account.region === currentRegionKey()) {
      points += 24;
      reasons.push('na região da semana');
    }

    if (account.stage === 'Negociação') {
      points += 30;
      reasons.push('em negociação');
    } else if (account.stage === 'Proposta') {
      points += 25;
      reasons.push('proposta em aberto');
    } else if (['Qualificado', 'Diagnóstico'].includes(account.stage)) points += 12;

    if (account.elite) {
      points += 18;
      reasons.push('cliente Elite');
    }
    if (account.trigger && account.trigger !== 'Outro') {
      points += 13;
      reasons.push('gatilho comercial');
    }
    if (Number(account.value || 0) >= 500000) {
      points += 12;
      reasons.push('alto valor potencial');
    }

    return {points, reasons: [...new Set(reasons)].slice(0, 3), dueDate, distance};
  }

  function actionableAccounts() {
    return state.accounts
      .filter(openAccountStage)
      .map(account => ({account, ...accountPriority(account)}))
      .filter(item => item.dueDate)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || b.points - a.points || String(a.account.company).localeCompare(String(b.account.company), 'pt-BR'));
  }

  function briefingAccounts() {
    return state.accounts
      .filter(openAccountStage)
      .map(account => ({account, ...accountPriority(account)}))
      .filter(item => item.points > 0)
      .sort((a, b) => b.points - a.points || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'))
      .slice(0, 4);
  }

  function dueLabel(item) {
    if (item.distance < 0) return 'Atrasado ' + Math.abs(item.distance) + 'd';
    if (item.distance === 0) return 'Hoje';
    if (item.distance === 1) return 'Amanhã';
    if (item.distance <= 7) return 'Em ' + item.distance + ' dias';
    return formatShortDate(item.dueDate);
  }

  function formatShortDate(value) {
    if (!validDate(value)) return 'Sem data';
    return new Intl.DateTimeFormat('pt-BR', {day: '2-digit', month: 'short', timeZone: 'UTC'})
      .format(new Date(value + 'T12:00:00Z')).replace('.', '');
  }

  function dateTile(value) {
    const date = new Date(value + 'T12:00:00Z');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const month = new Intl.DateTimeFormat('pt-BR', {month: 'short', timeZone: 'UTC'}).format(date).replace('.', '');
    return day + '<br>' + esc(month);
  }

  function recordReminderHistory(account, type, previousDate, newDate, detail) {
    state.reminderHistory.push({
      id: crypto.randomUUID ? crypto.randomUUID() : 'r' + Date.now(),
      accountId: account.id,
      type,
      previousDate: previousDate || '',
      newDate: newDate || '',
      detail: detail || '',
      at: new Date().toISOString()
    });
    state.reminderHistory = state.reminderHistory.slice(-160);
  }

  function appToast(message) {
    const toast = document.getElementById('appToast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translate(-50%,0)';
    window.setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%,18px)';
    }, 3300);
  }

  function saveSmartState(message) {
    commit(normalizeV3(state));
    if (message) appToast(message);
  }

  function completeReminder(accountId) {
    const account = state.accounts.find(item => item.id === accountId);
    if (!account) return;
    const previousDate = reminderDate(account);
    const cadence = cleanNumber(account.reminder?.cadenceDays, CADENCES, state.smartSettings.defaultCadenceDays);
    account.lastContact = todayISO();
    account.lastCompletedAction = account.nextAction || 'Retorno comercial';
    account.lastCompletedAt = new Date().toISOString();
    if (cadence > 0) {
      account.nextDate = shiftDate(todayISO(), cadence);
      account.nextAction = 'Retornar ao cliente';
    } else {
      account.nextDate = '';
      account.nextAction = '';
    }
    recordReminderHistory(account, 'complete', previousDate, account.nextDate, account.lastCompletedAction);
    saveSmartState(cadence > 0 ? 'Concluído. Novo retorno programado para ' + formatShortDate(account.nextDate) + '.' : 'Ação concluída.');
  }

  function snoozeReminder(accountId, days) {
    const account = state.accounts.find(item => item.id === accountId);
    if (!account || ![1, 3, 7].includes(Number(days))) return;
    const previousDate = reminderDate(account);
    account.nextDate = shiftDate(todayISO(), Number(days));
    if (!account.nextAction) account.nextAction = 'Retornar ao cliente';
    recordReminderHistory(account, 'snooze', previousDate, account.nextDate, 'Adiado por ' + days + ' dia(s)');
    saveSmartState('Retorno adiado para ' + formatShortDate(account.nextDate) + '.');
  }

  function smartMetric(label, value, className) {
    return '<div class="smart-metric ' + className + '"><strong>' + value + '</strong><span>' + esc(label) + '</span></div>';
  }

  function renderBriefing() {
    const host = document.getElementById('smartBriefingCard');
    if (!host) return;
    const reminders = actionableAccounts();
    const priorities = briefingAccounts();
    const overdue = reminders.filter(item => item.distance < 0).length;
    const today = reminders.filter(item => item.distance === 0).length;
    const week = reminders.filter(item => item.distance > 0 && item.distance <= 7).length;
    const region = priorities.filter(item => item.account.region === currentRegionKey()).length;
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const summary = overdue
      ? 'Há ' + overdue + (overdue === 1 ? ' retorno vencido' : ' retornos vencidos') + '. Comece pelos itens com maior potencial abaixo.'
      : today
        ? 'Sua agenda tem ' + today + (today === 1 ? ' retorno para hoje' : ' retornos para hoje') + '.'
        : week
          ? 'A semana está organizada com ' + week + (week === 1 ? ' próxima ação' : ' próximas ações') + '.'
          : 'Nenhum retorno urgente. Aproveite a região da semana para avançar as melhores oportunidades.';

    const rows = priorities.length
      ? priorities.slice(0, 3).map((item, index) => {
          const detail = item.reasons.length ? item.reasons.join(' • ') : 'oportunidade para revisar';
          return '<button class="smart-priority-item" type="button" data-open-smart-account="' + esc(item.account.id) + '">' +
            '<span class="smart-rank">' + (index + 1) + '</span><span><strong>' + esc(item.account.company) + '</strong><small>' + esc(detail) + '</small></span>' +
            '<span class="smart-score">' + item.points + ' pts</span></button>';
        }).join('')
      : '<div class="smart-empty"><strong>Resumo pronto para começar</strong>Defina a próxima ação de um cliente para receber prioridades diárias.</div>';

    host.innerHTML = '<div class="smart-head"><div><span class="smart-kicker">' + smartIcon('brain') + ' Inteligência comercial</span>' +
      '<h3>' + greeting + ', Afonso</h3><p class="smart-summary-copy">' + esc(summary) + '</p></div>' +
      '<span class="smart-local-badge">Análise privada no aparelho</span></div>' +
      '<div class="smart-metrics">' + smartMetric('Vencidos', overdue, 'urgent') + smartMetric('Hoje', today, 'today') + smartMetric('Próximos 7 dias', week, 'week') + smartMetric('Na região', region, 'region') + '</div>' +
      '<div class="smart-priority-list">' + rows + '</div>' +
      '<div class="btnrow" style="margin-top:12px"><button class="btn secondary small" id="openSmartAgenda" type="button">Abrir agenda inteligente</button></div>';

    host.querySelectorAll('[data-open-smart-account]').forEach(button => {
      button.onclick = () => openAccount(button.dataset.openSmartAccount);
    });
    document.getElementById('openSmartAgenda').onclick = () => showSection('today');
  }

  function filterReminder(item) {
    if (agendaFilter === 'overdue') return item.distance < 0;
    if (agendaFilter === 'today') return item.distance === 0;
    if (agendaFilter === 'week') return item.distance > 0 && item.distance <= 7;
    return true;
  }

  function agendaGroup(item) {
    if (item.distance < 0) return 'Vencidos';
    if (item.distance === 0) return 'Hoje';
    if (item.distance <= 7) return 'Próximos 7 dias';
    return 'Depois';
  }

  function agendaItemMarkup(item) {
    const account = item.account;
    const statusClass = item.distance < 0 ? 'overdue' : item.distance === 0 ? 'today' : '';
    const itemClass = item.distance < 0 ? ' is-overdue' : item.distance === 0 ? ' is-today' : '';
    const reasons = item.reasons.length ? item.reasons.join(' • ') : 'próxima ação programada';
    const cadence = cleanNumber(account.reminder?.cadenceDays, CADENCES, state.smartSettings.defaultCadenceDays);
    const completeLabel = cadence ? 'Concluir • repetir ' + cadence + 'd' : 'Concluir';
    return '<div class="smart-agenda-item' + itemClass + '">' +
      '<button class="smart-agenda-main" type="button" data-smart-action="open" data-account-id="' + esc(account.id) + '">' +
      '<span class="smart-date-tile">' + dateTile(item.dueDate) + '</span><span><strong>' + esc(account.company) + '</strong>' +
      '<small>' + esc(account.nextAction || 'Retornar ao cliente') + ' • ' + esc(account.city || 'Cidade não informada') + '</small></span>' +
      '<span class="smart-due-state ' + statusClass + '">' + esc(dueLabel(item)) + '</span></button>' +
      '<div class="smart-agenda-reasons">Prioridade: ' + esc(reasons) + '.</div>' +
      '<div class="smart-agenda-actions"><button class="btn complete" type="button" data-smart-action="complete" data-account-id="' + esc(account.id) + '">' + smartIcon('check') + ' ' + esc(completeLabel) + '</button>' +
      '<button class="btn secondary" type="button" data-smart-action="snooze" data-days="1" data-account-id="' + esc(account.id) + '">+1 dia</button>' +
      '<button class="btn secondary" type="button" data-smart-action="snooze" data-days="3" data-account-id="' + esc(account.id) + '">+3 dias</button>' +
      '<button class="btn secondary" type="button" data-smart-action="snooze" data-days="7" data-account-id="' + esc(account.id) + '">+7 dias</button></div></div>';
  }

  function renderSmartAgenda() {
    const list = actionableAccounts().filter(filterReminder);
    const host = document.getElementById('todayList');
    const filterHost = document.getElementById('smartAgendaFilters');
    if (!host || !filterHost) return;
    filterHost.innerHTML = FILTERS.map(([key, label]) => '<button class="smart-filter ' + (agendaFilter === key ? 'active' : '') + '" type="button" data-agenda-filter="' + key + '">' + label + '</button>').join('');
    filterHost.querySelectorAll('[data-agenda-filter]').forEach(button => {
      button.onclick = () => {
        agendaFilter = button.dataset.agendaFilter;
        renderSmartAgenda();
      };
    });

    if (!list.length) {
      host.innerHTML = '<div class="smart-empty"><strong>Nenhuma ação neste filtro</strong>Abra um cliente para programar o próximo contato.</div>';
      return;
    }
    const groups = new Map();
    for (const item of list) {
      const group = agendaGroup(item);
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    }
    host.innerHTML = [...groups].map(([name, items]) => '<section class="smart-agenda-group"><div class="smart-agenda-group-title"><span>' + esc(name) + '</span><span>' + items.length + '</span></div>' + items.map(agendaItemMarkup).join('') + '</section>').join('');
  }

  function permissionState() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return 'unsupported';
    return Notification.permission;
  }

  function pushConfigured() {
    const config = window.AFONSO_PUSH_CONFIG || {};
    return Boolean(config.apiUrl && config.vapidPublicKey);
  }

  function notificationCopy() {
    const permission = permissionState();
    if (permission === 'denied') return {label: 'Bloqueadas no iPhone', className: 'blocked', text: 'Ative as notificações nos Ajustes do iPhone para receber os lembretes.'};
    if (permission === 'unsupported') return {label: 'Indisponíveis neste modo', className: 'blocked', text: 'No iPhone, abra o aplicativo pela Tela de Início para ativar os avisos.'};
    if (permission === 'granted' && !state.smartSettings.notificationsEnabled) return {label: 'Lembretes pausados', className: '', text: 'A permissão continua ativa no aparelho. Reative quando quiser voltar a receber os avisos.'};
    if (permission === 'granted' && pushConfigured()) return {label: 'Ativas em segundo plano', className: 'ok', text: 'Os alertas podem chegar mesmo com o aplicativo fechado.'};
    if (permission === 'granted') return {label: 'Ativas no aparelho', className: 'ok', text: 'Os avisos locais estão ativos. A conexão segura em segundo plano está sendo finalizada.'};
    return {label: 'Ainda não ativadas', className: '', text: 'Toque em Ativar para permitir lembretes na tela bloqueada e na Central de Notificações.'};
  }

  function renderNotificationControls() {
    const info = notificationCopy();
    for (const prefix of ['Agenda', 'Settings']) {
      const stateHost = document.getElementById('notification' + prefix + 'State');
      const copyHost = document.getElementById('notification' + prefix + 'Copy');
      if (stateHost) {
        stateHost.textContent = info.label;
        stateHost.className = 'notification-state ' + info.className;
      }
      if (copyHost) copyHost.textContent = info.text;
    }
    const enable = document.getElementById('enableNotifications');
    if (enable) {
      enable.disabled = notificationBusy || permissionState() === 'denied';
      enable.textContent = notificationBusy
        ? 'Atualizando…'
        : permissionState() === 'granted'
          ? state.smartSettings.notificationsEnabled ? 'Pausar lembretes' : 'Reativar lembretes'
          : 'Ativar notificações';
    }
    const test = document.getElementById('testNotification');
    if (test) test.disabled = permissionState() !== 'granted' || notificationBusy;
    const agendaEnable = document.getElementById('enableNotificationsAgenda');
    if (agendaEnable) {
      agendaEnable.hidden = permissionState() === 'granted' && state.smartSettings.notificationsEnabled;
      agendaEnable.disabled = notificationBusy || permissionState() === 'denied';
      agendaEnable.textContent = permissionState() === 'granted' ? 'Reativar lembretes' : 'Ativar notificações';
    }
    const cadence = document.getElementById('defaultReminderCadence');
    const lead = document.getElementById('defaultNotificationLead');
    const hour = document.getElementById('defaultNotificationHour');
    const discreet = document.getElementById('discreetNotifications');
    if (cadence) cadence.value = String(state.smartSettings.defaultCadenceDays);
    if (lead) lead.value = String(state.smartSettings.notificationLeadDays);
    if (hour) hour.value = state.smartSettings.notificationHour;
    if (discreet) discreet.checked = state.smartSettings.discreetNotifications;
  }

  async function showSystemNotification(title, options = {}) {
    if (permissionState() !== 'granted') return false;
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      icon: './icon-192.png',
      badge: './icon-192.png',
      tag: options.tag || 'afonso-comercial',
      renotify: true,
      data: {url: './?agenda=1'},
      ...options
    });
    return true;
  }

  async function requestNotifications() {
    if (notificationBusy) return;
    if (permissionState() === 'unsupported') {
      appToast('No iPhone, abra o app pela Tela de Início para ativar as notificações.');
      return;
    }
    notificationBusy = true;
    renderNotificationControls();
    try {
      const permission = await Notification.requestPermission();
      state.smartSettings.notificationsEnabled = permission === 'granted';
      commit(normalizeV3(state));
      if (permission === 'granted') {
        await showSystemNotification('Afonso Comercial', {body: 'Notificações ativadas. Seus retornos aparecerão aqui.', tag: 'afonso-notification-test'});
        await syncCloudSchedule();
      } else if (permission === 'denied') appToast('As notificações foram bloqueadas no aparelho.');
    } catch (error) {
      appToast('Não foi possível ativar as notificações neste aparelho.');
    } finally {
      notificationBusy = false;
      renderNotificationControls();
    }
  }

  async function toggleNotifications() {
    if (permissionState() !== 'granted') {
      await requestNotifications();
      return;
    }
    if (notificationBusy) return;
    notificationBusy = true;
    state.smartSettings.notificationsEnabled = !state.smartSettings.notificationsEnabled;
    commit(normalizeV3(state));
    renderNotificationControls();
    try {
      if (state.smartSettings.notificationsEnabled) {
        await syncCloudSchedule();
        appToast('Lembretes reativados.');
      } else {
        try {
          await syncCloudSchedule({clear: true, force: true});
        } finally {
          await unsubscribePush();
        }
        appToast('Lembretes pausados. Seus agendamentos continuam salvos no aparelho.');
      }
    } catch (error) {
      appToast(state.smartSettings.notificationsEnabled
        ? 'Lembretes reativados no aparelho. A sincronização será tentada novamente.'
        : 'Lembretes pausados no aparelho.');
    } finally {
      notificationBusy = false;
      renderNotificationControls();
    }
  }

  async function testNotification() {
    notificationBusy = true;
    renderNotificationControls();
    try {
      await showSystemNotification('Lembrete comercial', {body: 'Teste concluído: os avisos do Afonso Comercial estão funcionando.', tag: 'afonso-notification-test'});
      appToast('Notificação de teste enviada.');
    } catch (error) {
      appToast('Não foi possível enviar o teste.');
    } finally {
      notificationBusy = false;
      renderNotificationControls();
    }
  }

  function saveNotificationSettings() {
    state.smartSettings.defaultCadenceDays = cleanNumber(document.getElementById('defaultReminderCadence').value, CADENCES, 15);
    state.smartSettings.notificationLeadDays = cleanNumber(document.getElementById('defaultNotificationLead').value, LEAD_DAYS, 1);
    state.smartSettings.notificationHour = document.getElementById('defaultNotificationHour').value || '08:00';
    state.smartSettings.discreetNotifications = document.getElementById('discreetNotifications').checked;
    saveSmartState('Preferências de lembrete salvas.');
  }

  function urlBase64ToUint8Array(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(character => character.charCodeAt(0)));
  }

  async function digestKey(value) {
    if (!crypto.subtle) return value;
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function ensureDeviceCredentials() {
    if (!state.smartSettings.deviceId) state.smartSettings.deviceId = crypto.randomUUID ? crypto.randomUUID() : 'device-' + Date.now();
    if (!state.smartSettings.deviceSecret) {
      const bytes = new Uint8Array(24);
      crypto.getRandomValues(bytes);
      state.smartSettings.deviceSecret = btoa(String.fromCharCode(...bytes)).replace(/[^a-zA-Z0-9]/g, '');
    }
  }

  function notificationTimestamp(date, hour) {
    const timestamp = new Date(date + 'T' + hour + ':00');
    return Number.isNaN(timestamp.getTime()) ? '' : timestamp.toISOString();
  }

  async function unsubscribePush() {
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager?.getSubscription();
    if (subscription) await subscription.unsubscribe();
  }

  async function syncCloudSchedule({clear = false, force = false} = {}) {
    const config = window.AFONSO_PUSH_CONFIG || {};
    if (!config.apiUrl || !config.vapidPublicKey || permissionState() !== 'granted' || (!force && !state.smartSettings.notificationsEnabled)) return false;
    ensureDeviceCredentials();
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (clear && !subscription) return false;
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey)
      });
    }
    const schedules = [];
    for (const item of (clear ? [] : actionableAccounts().filter(entry => entry.account.reminder?.enabled !== false))) {
      const key = await digestKey(state.smartSettings.deviceId + '|' + item.account.id);
      const lead = reminderLead(item.account);
      const notifyDate = shiftDate(item.dueDate, -lead);
      const notifyAt = notificationTimestamp(notifyDate, state.smartSettings.notificationHour);
      if (!notifyAt) continue;
      schedules.push({
        key,
        dueDate: item.dueDate,
        notifyAt,
        title: state.smartSettings.discreetNotifications ? 'Lembrete comercial' : item.account.company,
        body: state.smartSettings.discreetNotifications ? 'Você tem um retorno comercial programado.' : (item.account.nextAction || 'Retornar ao cliente'),
        url: './?agenda=1'
      });
    }
    const response = await fetch(config.apiUrl.replace(/\/$/, '') + '/sync', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'X-Device-Secret': state.smartSettings.deviceSecret},
      body: JSON.stringify({
        deviceId: state.smartSettings.deviceId,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
        subscription: subscription.toJSON(),
        schedules
      })
    });
    if (!response.ok) throw new Error('Falha ao sincronizar notificações');
    state.smartSettings.lastScheduleSync = new Date().toISOString();
    localStorage.setItem(KEY, JSON.stringify(state));
    renderNotificationControls();
    return true;
  }

  function scheduleCloudSync() {
    window.clearTimeout(cloudSyncTimer);
    cloudSyncTimer = window.setTimeout(() => syncCloudSchedule().catch(() => {}), 450);
  }

  exportBackup = function() {
    const backup = structuredClone(state);
    if (backup.smartSettings) {
      backup.smartSettings.deviceId = '';
      backup.smartSettings.deviceSecret = '';
      backup.smartSettings.lastScheduleSync = '';
      backup.smartSettings.notificationsEnabled = false;
    }
    backup.notificationLog = {};
    const blob = new Blob([JSON.stringify(backup, null, 2)], {type: 'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'backup-afonso-comercial-' + todayISO() + '.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  importBackup = function(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await syncCloudSchedule({clear: true, force: true}).catch(() => {});
        await unsubscribePush().catch(() => {});
        const imported = normalizeV3(JSON.parse(reader.result));
        imported.smartSettings.deviceId = '';
        imported.smartSettings.deviceSecret = '';
        imported.smartSettings.lastScheduleSync = '';
        imported.smartSettings.notificationsEnabled = false;
        imported.notificationLog = {};
        state = imported;
        localStorage.setItem(KEY, JSON.stringify(state));
        renderAll();
        alert('Backup importado. Reative as notificações neste aparelho.');
      } catch (error) {
        alert('Arquivo de backup inválido.');
      }
      event.target.value = '';
    };
    reader.readAsText(file);
  };

  resetApp = async function() {
    if (!confirm('Tem certeza? Isso apagará todas as contas e oportunidades deste aparelho.')) return;
    await syncCloudSchedule({clear: true, force: true}).catch(() => {});
    await unsubscribePush().catch(() => {});
    state = normalizeV3(structuredClone(defaultState));
    localStorage.setItem(KEY, JSON.stringify(state));
    renderAll();
  };

  async function checkDueNotifications() {
    updateAppBadge();
    if (permissionState() !== 'granted' || !state.smartSettings.notificationsEnabled) return;
    const now = new Date();
    const [hour, minute] = state.smartSettings.notificationHour.split(':').map(Number);
    if (now.getHours() * 60 + now.getMinutes() < hour * 60 + minute) return;
    const today = todayISO();
    if (state.notificationLog[today]) return;
    const due = actionableAccounts().filter(item => item.account.reminder?.enabled !== false && shiftDate(item.dueDate, -reminderLead(item.account)) <= today);
    if (!due.length) return;
    const body = state.smartSettings.discreetNotifications
      ? 'Você tem ' + due.length + (due.length === 1 ? ' retorno comercial para revisar.' : ' retornos comerciais para revisar.')
      : due.slice(0, 2).map(item => item.account.company).join(' • ') + (due.length > 2 ? ' e mais ' + (due.length - 2) : '');
    try {
      await showSystemNotification('Agenda do dia', {body, tag: 'afonso-daily-' + today});
      state.notificationLog[today] = new Date().toISOString();
      const cutoff = shiftDate(today, -45);
      for (const key of Object.keys(state.notificationLog)) if (key < cutoff) delete state.notificationLog[key];
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (error) {}
  }

  function updateAppBadge() {
    const dueCount = actionableAccounts().filter(item => item.distance <= 0).length;
    const navBadge = document.getElementById('navReminderBadge');
    if (navBadge) {
      navBadge.hidden = dueCount === 0;
      navBadge.textContent = dueCount > 99 ? '99+' : String(dueCount);
    }
    if ('setAppBadge' in navigator) {
      if (dueCount) navigator.setAppBadge(dueCount).catch(() => {});
      else if ('clearAppBadge' in navigator) navigator.clearAppBadge().catch(() => {});
    }
  }

  function installStructure() {
    const smartStyles = document.querySelector('link[href="smart-assistant.css"]');
    if (smartStyles) document.head.append(smartStyles);

    const quickActions = document.querySelector('#home .quick-actions');
    const hero = document.querySelector('#home .hero');
    const briefing = document.createElement('section');
    briefing.id = 'smartBriefingCard';
    briefing.className = 'card smart-card';
    (quickActions || hero).insertAdjacentElement('afterend', briefing);

    const todaySection = document.getElementById('today');
    const todayHero = todaySection.querySelector('.hero');
    todayHero.insertAdjacentHTML('afterend',
      '<div class="card notification-panel"><div class="notification-head"><div><h3>Lembretes no iPhone</h3><p class="notification-copy" id="notificationAgendaCopy"></p></div><span class="notification-state" id="notificationAgendaState"></span></div>' +
      '<div class="notification-actions"><button class="btn small" id="enableNotificationsAgenda" type="button">Ativar notificações</button></div></div>' +
      '<div class="smart-agenda-toolbar"><div class="smart-agenda-head"><div><span class="smart-kicker">' + smartIcon('clock') + ' Agenda inteligente</span></div></div><div class="smart-filter-row" id="smartAgendaFilters"></div></div>'
    );

    const actionNav = document.querySelector('.nav button[data-section="today"]');
    if (actionNav) actionNav.insertAdjacentHTML('beforeend', '<span class="nav-reminder-badge" id="navReminderBadge" hidden>0</span>');

    const nextDateField = document.getElementById('nextDate')?.closest('div');
    if (nextDateField) {
      nextDateField.insertAdjacentHTML('afterend',
        '<div class="span2 smart-reminder-box"><div class="smart-reminder-title"><span class="reminder-inline-icon">' + smartIcon('bell') + '</span><strong>Lembrete deste cliente</strong></div>' +
        '<label class="smart-reminder-toggle"><input id="reminderEnabled" type="checkbox" checked> Avisar sobre esta próxima ação</label>' +
        '<div class="smart-reminder-grid"><div><label for="reminderCadence">Repetir após concluir</label><select id="reminderCadence"><option value="0">Não repetir</option><option value="7">Em 7 dias</option><option value="15">Em 15 dias</option><option value="30">Em 30 dias</option></select></div>' +
        '<div><label for="reminderLeadDays">Avisar com antecedência</label><select id="reminderLeadDays"><option value="0">No dia</option><option value="1">1 dia antes</option><option value="3">3 dias antes</option><option value="7">7 dias antes</option></select></div></div></div>'
      );
    }

    const settings = document.getElementById('settings');
    const installCard = [...settings.querySelectorAll('.card')].find(card => /Instalar no iPhone/i.test(card.textContent));
    const notificationCard = document.createElement('div');
    notificationCard.className = 'card notification-panel';
    notificationCard.id = 'notificationSettingsCard';
    notificationCard.innerHTML = '<div class="notification-head"><div><span class="smart-kicker">' + smartIcon('bell') + ' V7 • Lembretes</span><h3>Notificações e recorrência</h3><p class="notification-copy" id="notificationSettingsCopy"></p></div><span class="notification-state" id="notificationSettingsState"></span></div>' +
      '<div class="notification-actions"><button class="btn" id="enableNotifications" type="button">Ativar notificações</button><button class="btn secondary" id="testNotification" type="button">Testar aviso</button></div>' +
      '<div class="smart-settings-grid"><div><label for="defaultReminderCadence">Novo retorno padrão</label><select id="defaultReminderCadence"><option value="0">Sem repetição</option><option value="7">7 dias</option><option value="15">15 dias</option><option value="30">30 dias</option></select></div>' +
      '<div><label for="defaultNotificationLead">Antecedência padrão</label><select id="defaultNotificationLead"><option value="0">No dia</option><option value="1">1 dia antes</option><option value="3">3 dias antes</option><option value="7">7 dias antes</option></select></div>' +
      '<div><label for="defaultNotificationHour">Horário do resumo</label><input id="defaultNotificationHour" type="time"></div></div>' +
      '<label class="smart-check"><input id="discreetNotifications" type="checkbox"> Ocultar o nome do cliente na tela bloqueada</label>' +
      '<p class="smart-privacy-note">O resumo inteligente é calculado neste aparelho. Quando o envio em segundo plano estiver ativo, somente datas, identificadores protegidos e o texto escolhido para o aviso serão sincronizados.</p>';
    if (installCard) settings.insertBefore(notificationCard, installCard);
    else settings.prepend(notificationCard);

    const versionCard = [...settings.querySelectorAll('.card')].find(card => /Afonso Comercial.*V6/i.test(card.querySelector('h3')?.textContent || ''));
    if (versionCard) {
      versionCard.querySelector('h3').textContent = 'Afonso Comercial • V7';
      const copy = versionCard.querySelector('p');
      if (copy) copy.textContent = 'Agenda inteligente, retornos recorrentes, notificações no iPhone, planejamento flexível de regiões, clientes Elite, mapa e consulta de CNPJ. Seus cadastros continuam salvos neste aparelho.';
    }

    document.getElementById('todayList').addEventListener('click', event => {
      const button = event.target.closest('[data-smart-action]');
      if (!button) return;
      const accountId = button.dataset.accountId;
      if (button.dataset.smartAction === 'open') openAccount(accountId);
      if (button.dataset.smartAction === 'complete') completeReminder(accountId);
      if (button.dataset.smartAction === 'snooze') snoozeReminder(accountId, Number(button.dataset.days));
    });

    document.getElementById('enableNotifications').onclick = toggleNotifications;
    document.getElementById('enableNotificationsAgenda').onclick = toggleNotifications;
    document.getElementById('testNotification').onclick = testNotification;
    for (const id of ['defaultReminderCadence', 'defaultNotificationLead', 'defaultNotificationHour', 'discreetNotifications']) {
      document.getElementById(id).addEventListener('change', saveNotificationSettings);
    }
  }

  installStructure();

  const openBeforeSmart = openAccount;
  openAccount = function(id = '') {
    openBeforeSmart(id);
    const account = state.accounts.find(item => item.id === id);
    const reminder = account?.reminder || {};
    const enabled = document.getElementById('reminderEnabled');
    const cadence = document.getElementById('reminderCadence');
    const lead = document.getElementById('reminderLeadDays');
    if (enabled) enabled.checked = reminder.enabled !== false;
    if (cadence) cadence.value = String(cleanNumber(reminder.cadenceDays, CADENCES, account?.elite ? 15 : state.smartSettings.defaultCadenceDays));
    if (lead) lead.value = String(cleanNumber(reminder.leadDays, LEAD_DAYS, state.smartSettings.notificationLeadDays));
  };

  const renderTodayBeforeSmart = renderToday;
  renderToday = function() {
    renderSmartAgenda();
  };

  const showSectionBeforeSmart = showSection;
  showSection = function(id) {
    showSectionBeforeSmart(id);
    if (id === 'today') renderSmartAgenda();
  };

  const renderBeforeSmart = renderAll;
  renderAll = function() {
    renderBeforeSmart();
    renderBriefing();
    renderSmartAgenda();
    renderNotificationControls();
    updateAppBadge();
    scheduleCloudSync();
  };

  window.addEventListener('load', () => {
    checkDueNotifications();
    syncCloudSchedule().catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkDueNotifications();
  });

  if (new URLSearchParams(location.search).get('agenda') === '1') showSection('today');
  renderAll();
})();
