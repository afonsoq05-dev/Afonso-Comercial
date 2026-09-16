'use strict';

(() => {
  if (document.getElementById('routePlannerDialog')) return;

  const ROTATION_SEQUENCE = ['R1', 'R2', 'R3', 'R4A', 'R1', 'R2', 'R3', 'R4B'];
  const ROUTE_PLAN_VERSION = 1;
  const ROUTE_PLAN_WEEKS = 16;

  const ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
    route: '<circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M8.6 17.5 15.4 6.5M8.8 5H5a3 3 0 0 0 0 6h14a3 3 0 0 1 0 6h-3.8"/>',
    star: '<path d="m12 2.8 2.83 5.73 6.32.92-4.57 4.45 1.08 6.29L12 17.22l-5.66 2.97 1.08-6.29-4.57-4.45 6.32-.92L12 2.8Z"/>',
    pin: '<path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.1A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.1A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.1A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.15.36.36.7.6 1 .3.3.68.47 1.1.5h.1v4h-.1A1.7 1.7 0 0 0 19.4 15Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
    swap: '<path d="m16 3 4 4-4 4M20 7H8a4 4 0 0 0-4 4M8 21l-4-4 4-4M4 17h12a4 4 0 0 0 4-4"/>',
    map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/>',
    target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/>'
  };

  function icon(name) {
    return '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || ICONS.briefcase) + '</svg>';
  }

  function validRegion(key) {
    return Boolean(CONFIG.regions[key]);
  }

  function startIndexFor(regionKey, plan) {
    if (regionKey === 'R4A') return 3;
    if (regionKey === 'R4B') return 7;
    const priorFour = [...(plan?.entries || [])].reverse().find(entry => ['R4A', 'R4B'].includes(entry.baselineRegionKey));
    const offset = priorFour?.baselineRegionKey === 'R4A' ? 4 : 0;
    if (regionKey === 'R2') return offset + 1;
    if (regionKey === 'R3') return offset + 2;
    return offset;
  }

  function buildEntries(start, regionKey, count = ROUTE_PLAN_WEEKS, previousPlan = null) {
    const firstIndex = startIndexFor(regionKey, previousPlan);
    return Array.from({length: count}, (_, index) => {
      const cycleIndex = (firstIndex + index) % ROTATION_SEQUENCE.length;
      const baselineRegionKey = ROTATION_SEQUENCE[cycleIndex];
      return {
        weekStart: addDays(start, index * 7),
        cycleIndex,
        baselineRegionKey,
        regionKey: baselineRegionKey,
        changeType: 'cycle',
        note: ''
      };
    });
  }

  function createPlanner(source) {
    const anchorWeek = monday(todayISO());
    const startRegion = validRegion(source.weekKey) ? source.weekKey : 'R1';
    const planner = {
      version: ROUTE_PLAN_VERSION,
      anchorWeek,
      entries: buildEntries(anchorWeek, startRegion),
      history: []
    };

    const launchDate = todayISO();
    if (anchorWeek === '2026-09-14' && launchDate <= '2026-09-20' && startRegion === 'R4B') {
      const current = planner.entries[0];
      const next = planner.entries[1];
      [current.regionKey, next.regionKey] = [next.regionKey, current.regionKey];
      current.changeType = 'swap';
      next.changeType = 'swap';
      current.note = 'Troca excepcional: cliente de grande potencial retorna em 20/09.';
      next.note = current.note;
      planner.history.push({
        changedAt: new Date().toISOString(),
        type: 'swap',
        weeks: [current.weekStart, next.weekStart],
        note: current.note
      });
    }
    return planner;
  }

  function plannerIsValid(planner) {
    return planner && Array.isArray(planner.entries) && planner.entries.length &&
      planner.entries.every(entry => dateOK(entry.weekStart) && validRegion(entry.regionKey));
  }

  function ensurePlannerCoverage(source) {
    if (!plannerIsValid(source.routePlanner)) source.routePlanner = createPlanner(source);
    const planner = source.routePlanner;
    planner.version = ROUTE_PLAN_VERSION;
    planner.history = Array.isArray(planner.history) ? planner.history.slice(-40) : [];
    planner.entries.sort((a, b) => a.weekStart.localeCompare(b.weekStart));

    for (const entry of planner.entries) {
      if (!validRegion(entry.baselineRegionKey)) entry.baselineRegionKey = entry.regionKey;
      if (!Number.isInteger(entry.cycleIndex)) entry.cycleIndex = startIndexFor(entry.baselineRegionKey, planner);
      if (!['cycle', 'manual', 'swap', 'repeat'].includes(entry.changeType)) {
        entry.changeType = entry.regionKey === entry.baselineRegionKey ? 'cycle' : 'manual';
      }
      entry.note = String(entry.note || '');
    }

    const currentWeek = monday(todayISO());
    const first = planner.entries[0];
    if (currentWeek < first.weekStart) source.routePlanner = createPlanner(source);

    let entries = source.routePlanner.entries;
    let last = entries[entries.length - 1];
    const requiredThrough = addDays(currentWeek, (ROUTE_PLAN_WEEKS - 1) * 7);
    while (last.weekStart < requiredThrough) {
      const cycleIndex = (Number(last.cycleIndex) + 1) % ROTATION_SEQUENCE.length;
      const baselineRegionKey = ROTATION_SEQUENCE[cycleIndex];
      last = {
        weekStart: addDays(last.weekStart, 7),
        cycleIndex,
        baselineRegionKey,
        regionKey: baselineRegionKey,
        changeType: 'cycle',
        note: ''
      };
      entries.push(last);
    }
    source.routePlanner.entries = entries.filter(entry => entry.weekStart >= addDays(currentWeek, -56)).slice(0, 40);
    source.routePlanner.anchorWeek = source.routePlanner.entries[0].weekStart;
    return source;
  }

  function normalizeV6(source) {
    source = ensurePlannerCoverage(source);
    source.schemaVersion = Math.max(6, Number(source.schemaVersion) || 0);
    return source;
  }

  const normalizeBeforeV6 = normalizeV3;
  normalizeV3 = function(source) {
    return normalizeV6(normalizeBeforeV6(source));
  };

  function entryFor(weekStart) {
    ensurePlannerCoverage(state);
    return state.routePlanner.entries.find(entry => entry.weekStart === weekStart);
  }

  function activeEntry() {
    return entryFor(monday(todayISO()));
  }

  function nextEntry() {
    return entryFor(addDays(monday(todayISO()), 7));
  }

  function syncActiveRegion() {
    const active = activeEntry();
    if (active && state.weekKey !== active.regionKey) state.weekKey = active.regionKey;
  }

  state = normalizeV3(state);
  syncActiveRegion();
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (error) {}

  const currentRegionBeforePlanner = currentRegionKey;
  currentRegionKey = function() {
    return activeEntry()?.regionKey || currentRegionBeforePlanner();
  };

  setWeek = function(regionKey) {
    if (!validRegion(regionKey)) return;
    const entry = activeEntry();
    entry.regionKey = regionKey;
    entry.changeType = regionKey === entry.baselineRegionKey ? 'cycle' : 'manual';
    entry.note = entry.changeType === 'cycle' ? '' : 'Ajuste manual da região ativa.';
    state.weekKey = regionKey;
    state.routePlanner.history.push({
      changedAt: new Date().toISOString(),
      type: 'manual',
      weeks: [entry.weekStart],
      note: entry.note
    });
    commit(normalizeV3(state));
  };

  function formatMonth(date) {
    return new Intl.DateTimeFormat('pt-BR', {month: 'short', timeZone: 'UTC'}).format(date).replace('.', '');
  }

  function formatWeekRange(weekStart) {
    const start = new Date(weekStart + 'T12:00:00Z');
    const finish = new Date(addDays(weekStart, 4) + 'T12:00:00Z');
    const startDay = String(start.getUTCDate()).padStart(2, '0');
    const finishDay = String(finish.getUTCDate()).padStart(2, '0');
    if (start.getUTCMonth() === finish.getUTCMonth()) return startDay + '–' + finishDay + ' ' + formatMonth(finish);
    return startDay + ' ' + formatMonth(start) + '–' + finishDay + ' ' + formatMonth(finish);
  }

  function regionLabel(regionKey) {
    const region = CONFIG.regions[regionKey];
    return region ? 'Semana ' + region.label + ' — ' + region.short : 'Região a definir';
  }

  function regionOptions() {
    return REGION_ORDER.map(key => '<option value="' + key + '">' + esc(regionLabel(key)) + '</option>').join('');
  }

  function installStructure() {
    const modernStyles = document.querySelector('link[href="modern-ui.css"]');
    if (modernStyles) document.head.append(modernStyles);

    const firstBrandBlock = document.querySelector('.brand > div:first-child');
    if (firstBrandBlock && !firstBrandBlock.classList.contains('brand-lockup')) {
      firstBrandBlock.className = 'brand-lockup';
      firstBrandBlock.innerHTML = '<span class="brand-mark">' + icon('briefcase') + '</span><span class="brand-text"><h1>AFONSO COMERCIAL</h1><small>Máquinas pesadas • Norte do Paraná</small></span>';
    }

    const settingsButton = document.querySelector('.brand .close');
    if (settingsButton) settingsButton.innerHTML = icon('settings');
    const accountClose = document.querySelector('#accountDialog .close');
    if (accountClose) accountClose.innerHTML = icon('close');

    const hero = document.querySelector('#home .hero');
    hero.insertAdjacentHTML('beforeend',
      '<div id="routeStatusGrid" class="route-status-grid"></div>' +
      '<div id="routeChangeNote" class="route-change-note" hidden></div>' +
      '<div class="route-hero-actions"><button class="btn secondary small btn-icon" id="openRoutePlannerHero" type="button">' + icon('swap') + ' Ajustar rota</button></div>'
    );

    const quickActions = document.createElement('div');
    quickActions.className = 'quick-actions';
    quickActions.innerHTML =
      '<button class="quick-action" id="quickNewAccount" type="button">' + icon('plus') + 'Nova conta</button>' +
      '<button class="quick-action" id="quickCitySearch" type="button">' + icon('search') + 'Buscar cidade</button>' +
      '<button class="quick-action" id="quickAgenda" type="button">' + icon('calendar') + 'Agenda</button>' +
      '<button class="quick-action" id="quickRoute" type="button">' + icon('route') + 'Trocar região</button>';
    hero.insertAdjacentElement('afterend', quickActions);

    const agenda = document.createElement('div');
    agenda.className = 'card';
    agenda.id = 'agendaPreviewCard';
    agenda.innerHTML = '<div class="account-head"><div><h3>Próximos compromissos</h3><div class="muted" style="font-size:12px">O que merece sua atenção primeiro.</div></div><button class="btn secondary small" id="openFullAgenda" type="button">Ver agenda</button></div><div class="divider"></div><div id="agendaPreview" class="agenda-preview-list"></div>';
    document.getElementById('kpis').insertAdjacentElement('afterend', agenda);

    const plannerPanel = document.createElement('div');
    plannerPanel.className = 'card';
    plannerPanel.id = 'routePlannerPanel';
    plannerPanel.innerHTML =
      '<div class="route-planner-head"><div><h3>Planejamento das regiões</h3><p class="muted" style="font-size:12px">Troque semanas sem perder a sequência oficial.</p></div><span class="section-title-icon">' + icon('route') + '</span></div>' +
      '<div id="routeTimeline" class="route-timeline"></div>' +
      '<div class="btnrow"><button class="btn btn-icon" id="quickSwapWeeks" type="button">' + icon('swap') + ' Trocar com a próxima</button><button class="btn secondary" id="customizeWeeks" type="button">Personalizar</button><button class="btn ghost" id="restoreCycle" type="button">Restaurar ciclo</button></div>';
    const regionSection = document.getElementById('regions');
    regionSection.insertBefore(plannerPanel, regionSection.firstElementChild);

    const plannerDialog = document.createElement('dialog');
    plannerDialog.id = 'routePlannerDialog';
    plannerDialog.innerHTML =
      '<div class="modalhead"><strong>Ajustar regiões</strong><button class="close" id="closeRoutePlanner" type="button" aria-label="Fechar">' + icon('close') + '</button></div>' +
      '<div class="modalbody"><p class="route-dialog-copy">A alteração vale apenas para as semanas indicadas. As semanas seguintes continuam na ordem planejada.</p>' +
      '<form id="routePlannerForm" class="formgrid"><div><label id="currentRouteLabel" for="currentRouteSelect">Esta semana</label><select id="currentRouteSelect">' + regionOptions() + '</select></div>' +
      '<div><label id="nextRouteLabel" for="nextRouteSelect">Próxima semana</label><select id="nextRouteSelect">' + regionOptions() + '</select></div>' +
      '<div class="span2"><button class="btn secondary btn-icon route-swap-button" id="swapRouteFields" type="button">' + icon('swap') + ' Inverter as duas regiões</button>' +
      '<label for="routeChangeReason">Motivo do ajuste</label><input id="routeChangeReason" maxlength="180" placeholder="Ex.: cliente retorna de viagem em 20/09"></div>' +
      '<div class="span2 btnrow"><button class="btn" type="submit">Salvar planejamento</button><button class="btn secondary" id="cancelRoutePlanner" type="button">Cancelar</button></div></form></div>';
    document.body.append(plannerDialog);

    const toast = document.createElement('div');
    toast.id = 'appToast';
    toast.setAttribute('role', 'status');
    toast.style.cssText = 'position:fixed;z-index:80;left:50%;bottom:104px;transform:translate(-50%,18px);max-width:calc(100% - 30px);padding:11px 15px;border:1px solid rgba(255,122,26,.35);border-radius:13px;background:#171e27;color:#fff;box-shadow:0 16px 45px rgba(0,0,0,.45);opacity:0;pointer-events:none;transition:.2s ease';
    document.body.append(toast);

    document.getElementById('quickNewAccount').onclick = () => openAccount();
    document.getElementById('quickCitySearch').onclick = () => showSection('cityDirectory');
    document.getElementById('quickAgenda').onclick = () => showSection('today');
    document.getElementById('quickRoute').onclick = () => openPlanner(false);
    document.getElementById('openRoutePlannerHero').onclick = () => openPlanner(false);
    document.getElementById('openFullAgenda').onclick = () => showSection('today');
    document.getElementById('quickSwapWeeks').onclick = openQuickSwap;
    document.getElementById('customizeWeeks').onclick = () => openPlanner(false);
    document.getElementById('restoreCycle').onclick = restoreCycle;
    document.getElementById('closeRoutePlanner').onclick = () => plannerDialog.close();
    document.getElementById('cancelRoutePlanner').onclick = () => plannerDialog.close();
    document.getElementById('swapRouteFields').onclick = swapDialogFields;
    document.getElementById('routePlannerForm').onsubmit = savePlanner;

    installIcons();
    decorateHeadings();
    updateVersionCard();
  }

  function installIcons() {
    const navIcons = {home: 'home', accounts: 'users', today: 'check', regions: 'route', elite: 'star', map: 'pin'};
    document.querySelectorAll('.nav button').forEach(button => {
      const host = button.querySelector('.ico');
      if (host) host.innerHTML = icon(navIcons[button.dataset.section] || 'briefcase');
    });
  }

  function decorateHeadings() {
    const rules = [
      [/Cobertura da região/i, 'map'], [/Rota sugerida/i, 'route'], [/Radar/i, 'target'],
      [/Metas da semana/i, 'check'], [/Backup dos dados/i, 'database'], [/Importar clientes/i, 'users'],
      [/Instalar no iPhone/i, 'home'], [/Regra operacional/i, 'briefcase'], [/Limpar aplicativo/i, 'settings'],
      [/Ciclo comercial/i, 'swap'], [/Seu território/i, 'map']
    ];
    document.querySelectorAll('h3').forEach(heading => {
      if (heading.querySelector('.section-title-icon')) return;
      const original = heading.textContent.trim();
      const match = rules.find(([pattern]) => pattern.test(original));
      if (!match) return;
      const clean = original.replace(/^[^A-Za-zÀ-ÿ0-9]+/u, '');
      heading.innerHTML = '<span class="section-title-icon">' + icon(match[1]) + '</span>' + esc(clean);
    });
  }

  function updateVersionCard() {
    const cards = [...document.querySelectorAll('#settings .card')];
    const versionCard = cards.find(card => /V3|Elite e mapa/i.test(card.querySelector('h3')?.textContent || ''));
    if (!versionCard) return;
    const title = versionCard.querySelector('h3');
    const copy = versionCard.querySelector('p');
    title.textContent = 'Afonso Comercial • V6';
    copy.textContent = 'Planejamento flexível de regiões, agenda destacada, clientes Elite, mapa e consulta de CNPJ em duas fontes. Seus dados continuam salvos neste aparelho.';
  }

  function renderRoutePlanner() {
    syncActiveRegion();
    const current = activeEntry();
    const next = nextEntry();
    if (!current || !next) return;
    const status = document.getElementById('routeStatusGrid');
    status.innerHTML =
      '<div class="route-status current"><span class="route-status-label">Ativa agora</span><strong>' + esc(regionLabel(current.regionKey)) + '</strong><small>' + esc(formatWeekRange(current.weekStart)) + '</small></div>' +
      '<div class="route-status"><span class="route-status-label">Próxima</span><strong>' + esc(regionLabel(next.regionKey)) + '</strong><small>' + esc(formatWeekRange(next.weekStart)) + '</small></div>';

    const note = document.getElementById('routeChangeNote');
    const activeNotes = [...new Set([current.note, next.note].filter(Boolean))];
    note.hidden = !activeNotes.length;
    note.textContent = activeNotes.join(' ');

    const timeline = document.getElementById('routeTimeline');
    const currentWeek = monday(todayISO());
    timeline.innerHTML = state.routePlanner.entries
      .filter(entry => entry.weekStart >= currentWeek)
      .slice(0, 4)
      .map((entry, index) => {
        const changed = entry.regionKey !== entry.baselineRegionKey;
        const badge = index === 0 ? 'Agora' : entry.changeType === 'swap' ? 'Troca' : changed ? 'Ajustada' : 'Ciclo';
        return '<div class="route-week-row ' + (index === 0 ? 'active' : '') + '">' +
          '<div class="route-week-date">' + esc(formatWeekRange(entry.weekStart)) + '</div>' +
          '<div><div class="route-week-name">' + esc(regionLabel(entry.regionKey)) + '</div>' +
          (changed ? '<div class="route-original">Original: ' + esc(regionLabel(entry.baselineRegionKey)) + '</div>' : '') + '</div>' +
          '<div class="route-week-badge">' + badge + '</div></div>';
      }).join('');

    const alreadySwapped = current.regionKey === next.baselineRegionKey && next.regionKey === current.baselineRegionKey;
    const swapButton = document.getElementById('quickSwapWeeks');
    swapButton.innerHTML = icon('swap') + (alreadySwapped ? ' Editar troca programada' : ' Trocar com a próxima');
  }

  function renderAgendaPreview() {
    const host = document.getElementById('agendaPreview');
    const items = state.accounts
      .filter(account => account.nextDate && !String(account.stage || '').startsWith('Fechado'))
      .sort((a, b) => a.nextDate.localeCompare(b.nextDate) || score(b) - score(a))
      .slice(0, 3);
    host.replaceChildren();
    if (!items.length) {
      host.innerHTML = '<div class="empty" style="padding:14px">Nenhuma próxima ação programada. Abra um cliente e defina a data do retorno.</div>';
      return;
    }
    for (const account of items) {
      const date = new Date(account.nextDate + 'T12:00:00Z');
      const day = String(date.getUTCDate()).padStart(2, '0');
      const month = formatMonth(date);
      const status = account.nextDate < todayISO() ? 'Atrasado' : account.nextDate === todayISO() ? 'Hoje' : 'Agendado';
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'agenda-preview-item';
      item.innerHTML = '<span class="agenda-date">' + day + '<br>' + esc(month) + '</span><span><strong>' + esc(account.company) + '</strong><small>' + esc(account.nextAction || 'Próxima ação') + ' • ' + esc(account.city) + '</small></span><span class="agenda-state ' + (status === 'Atrasado' ? 'overdue' : '') + '">' + status + '</span>';
      item.onclick = () => openAccount(account.id);
      host.append(item);
    }
  }

  function openPlanner(prefillSwap) {
    const current = activeEntry();
    const next = nextEntry();
    document.getElementById('currentRouteLabel').textContent = 'Esta semana • ' + formatWeekRange(current.weekStart);
    document.getElementById('nextRouteLabel').textContent = 'Próxima semana • ' + formatWeekRange(next.weekStart);
    document.getElementById('currentRouteSelect').value = current.regionKey;
    document.getElementById('nextRouteSelect').value = next.regionKey;
    document.getElementById('routeChangeReason').value = current.note || next.note || '';
    if (prefillSwap) swapDialogFields();
    document.getElementById('routePlannerDialog').showModal();
  }

  function openQuickSwap() {
    const current = activeEntry();
    const next = nextEntry();
    const alreadySwapped = current.regionKey === next.baselineRegionKey && next.regionKey === current.baselineRegionKey;
    openPlanner(!alreadySwapped);
  }

  function swapDialogFields() {
    const current = document.getElementById('currentRouteSelect');
    const next = document.getElementById('nextRouteSelect');
    [current.value, next.value] = [next.value, current.value];
    const reason = document.getElementById('routeChangeReason');
    if (!reason.value) reason.value = 'Troca excepcional entre a região desta semana e a da próxima.';
  }

  function savePlanner(event) {
    event.preventDefault();
    const current = activeEntry();
    const next = nextEntry();
    const currentRegion = document.getElementById('currentRouteSelect').value;
    const nextRegion = document.getElementById('nextRouteSelect').value;
    const reason = document.getElementById('routeChangeReason').value.trim();
    if (!validRegion(currentRegion) || !validRegion(nextRegion)) return;

    const changed = currentRegion !== current.baselineRegionKey || nextRegion !== next.baselineRegionKey;
    if (changed && !reason) {
      document.getElementById('routeChangeReason').focus();
      alert('Informe o motivo para lembrar por que a rota foi alterada.');
      return;
    }
    const isSwap = currentRegion === next.baselineRegionKey && nextRegion === current.baselineRegionKey;
    current.regionKey = currentRegion;
    next.regionKey = nextRegion;
    current.changeType = currentRegion === current.baselineRegionKey ? 'cycle' : isSwap ? 'swap' : currentRegion === nextRegion ? 'repeat' : 'manual';
    next.changeType = nextRegion === next.baselineRegionKey ? 'cycle' : isSwap ? 'swap' : currentRegion === nextRegion ? 'repeat' : 'manual';
    current.note = current.changeType === 'cycle' ? '' : reason;
    next.note = next.changeType === 'cycle' ? '' : reason;
    state.weekKey = current.regionKey;
    state.routePlanner.history.push({
      changedAt: new Date().toISOString(),
      type: isSwap ? 'swap' : 'manual',
      weeks: [current.weekStart, next.weekStart],
      note: reason
    });
    document.getElementById('routePlannerDialog').close();
    commit(normalizeV3(state));
    showToast('Planejamento salvo. A próxima semana já ficou organizada.');
  }

  function restoreCycle() {
    const current = activeEntry();
    const next = nextEntry();
    if (!confirm('Restaurar estas duas semanas para a sequência original?')) return;
    for (const entry of [current, next]) {
      entry.regionKey = entry.baselineRegionKey;
      entry.changeType = 'cycle';
      entry.note = '';
    }
    state.weekKey = current.regionKey;
    state.routePlanner.history.push({
      changedAt: new Date().toISOString(),
      type: 'restore',
      weeks: [current.weekStart, next.weekStart],
      note: 'Ciclo original restaurado.'
    });
    commit(normalizeV3(state));
    showToast('Ciclo original restaurado para estas duas semanas.');
  }

  let toastTimer;
  function showToast(message) {
    const toast = document.getElementById('appToast');
    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translate(-50%,0)';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translate(-50%,18px)';
    }, 3200);
  }

  installStructure();

  const renderBeforePlanner = renderAll;
  renderAll = function() {
    syncActiveRegion();
    renderBeforePlanner();
    renderRoutePlanner();
    renderAgendaPreview();
    installIcons();
  };

  renderAll();
})();
