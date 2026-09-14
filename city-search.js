'use strict';
(() => {
  let selectedCityKey = '';

  const style = document.createElement('style');
  style.textContent =
    '.city-directory-item{width:100%;border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:16px;padding:14px;text-align:left;display:flex;justify-content:space-between;align-items:center;gap:12px}' +
    '.city-directory-item:active{transform:scale(.99);border-color:var(--accent)}' +
    '.city-directory-name{font-weight:850;font-size:16px}' +
    '.city-directory-meta{color:var(--muted);font-size:13px;margin-top:4px;line-height:1.4;display:block}' +
    '.city-directory-count{min-width:54px;text-align:center;background:#26170b;color:var(--accent2);border:1px solid #5b3110;border-radius:12px;padding:8px;font-weight:850}' +
    '.city-directory-summary h3{font-size:20px;margin-bottom:6px}' +
    '.city-directory-summary .btnrow{margin-top:12px}' +
    '#cityDirectorySuggestionsTitle,#cityDirectoryResultsTitle{margin:16px 2px 10px;font-size:14px;color:var(--muted)}';
  document.head.append(style);

  const section = document.createElement('section');
  section.id = 'cityDirectory';
  section.className = 'section';
  section.innerHTML =
    '<div class="hero"><div class="eyebrow">Carteira territorial</div><h2>Clientes por cidade</h2>' +
    '<p>Digite uma cidade para localizar todos os clientes, conferir prioridades e abrir o cadastro.</p></div>' +
    '<div class="card"><label for="cityDirectorySearch">Cidade</label>' +
    '<input id="cityDirectorySearch" list="cityDirectoryOptions" placeholder="Ex.: Ibaiti, Londrina, Cornélio Procópio…" autocomplete="off">' +
    '<datalist id="cityDirectoryOptions"></datalist><div class="formgrid" style="margin-top:11px">' +
    '<div><label for="cityDirectoryPriority">Prioridade</label><select id="cityDirectoryPriority">' +
    '<option value="ALL">Todas</option><option value="ELITE">Somente Elite</option><option value="A">Prioridade A</option>' +
    '<option value="B">Prioridade B</option><option value="C">Prioridade C</option></select></div>' +
    '<div><label for="cityDirectorySegment">Segmento</label><select id="cityDirectorySegment"></select></div></div>' +
    '<div class="btnrow" style="margin-top:11px"><button class="btn secondary small" type="button" id="cityDirectoryClear">Limpar busca</button>' +
    '<button class="btn secondary small" type="button" id="cityDirectoryBack">Ver todas as contas</button></div></div>' +
    '<div id="cityDirectoryContext"></div><div id="cityDirectorySuggestionsTitle"></div>' +
    '<div id="cityDirectorySuggestions" class="list"></div><div id="cityDirectoryResultsTitle"></div>' +
    '<div id="cityDirectoryResults" class="list"></div>';
  document.querySelector('main').append(section);

  const accountsActions = document.querySelector('#accounts .btnrow');
  if (accountsActions) {
    const openDirectory = document.createElement('button');
    openDirectory.type = 'button';
    openDirectory.className = 'btn secondary';
    openDirectory.textContent = '⌕ Por cidade';
    openDirectory.onclick = () => showSection('cityDirectory');
    accountsActions.append(openDirectory);
  }

  const coverage = document.getElementById('coverageList');
  if (coverage && coverage.parentElement) {
    const quickOpen = document.createElement('button');
    quickOpen.type = 'button';
    quickOpen.className = 'btn secondary small';
    quickOpen.style.marginTop = '12px';
    quickOpen.textContent = 'Pesquisar clientes por cidade';
    quickOpen.onclick = () => showSection('cityDirectory');
    coverage.parentElement.append(quickOpen);
  }

  const searchInput = document.getElementById('cityDirectorySearch');
  const prioritySelect = document.getElementById('cityDirectoryPriority');
  const segmentSelect = document.getElementById('cityDirectorySegment');
  segmentSelect.innerHTML = '<option value="ALL">Todos os segmentos</option>' +
    CONFIG.segments.map(s => '<option value="' + esc(s) + '">' + esc(s) + '</option>').join('');

  function catalog() {
    const names = new Map();
    for (const city of allCities) {
      const key = normKey(city);
      if (key) names.set(key, city);
    }
    for (const account of state.accounts) {
      const name = String(account.city || '').trim();
      const key = normKey(name);
      if (key && !names.has(key)) names.set(key, name);
    }
    return [...names].map(([key, name]) => {
      const accounts = state.accounts.filter(a => normKey(a.city) === key);
      const regionKey = originalRegion(name) || accounts.find(a => CONFIG.regions[a.region])?.region || '';
      return {key, name, accounts, regionKey};
    }).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  function refreshDatalist(items) {
    const host = document.getElementById('cityDirectoryOptions');
    host.replaceChildren();
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.name;
      option.label = item.accounts.length + (item.accounts.length === 1 ? ' cliente' : ' clientes');
      host.append(option);
    }
  }

  function chooseCity(item) {
    selectedCityKey = item.key;
    searchInput.value = item.name;
    renderCityDirectory();
    window.scrollTo({top: section.offsetTop, behavior: 'smooth'});
  }

  function openNewAccount(item) {
    openAccount();
    document.getElementById('city').value = item.name;
    document.getElementById('region').value = item.regionKey || 'UNMAPPED';
    refreshCircuitHint();
  }

  function renderCitySuggestions(items, query) {
    const title = document.getElementById('cityDirectorySuggestionsTitle');
    const host = document.getElementById('cityDirectorySuggestions');
    host.replaceChildren();
    let matches;
    if (query) {
      matches = items.filter(item => item.key.includes(query));
      title.textContent = matches.length ? 'Cidades encontradas' : '';
    } else {
      matches = items.filter(item => item.regionKey === currentRegionKey());
      matches.sort((a, b) => b.accounts.length - a.accounts.length || a.name.localeCompare(b.name, 'pt-BR'));
      title.textContent = 'Cidades da Semana ' + (CONFIG.regions[currentRegionKey()]?.label || '');
    }

    for (const item of matches.slice(0, 30)) {
      const cityButton = document.createElement('button');
      cityButton.type = 'button';
      cityButton.className = 'city-directory-item';
      const region = CONFIG.regions[item.regionKey]?.short || 'Região a definir';
      const circuit = circuitOf(item.name)?.name || 'Circuito a definir';
      cityButton.innerHTML =
        '<span><span class="city-directory-name">' + esc(item.name) + '</span>' +
        '<span class="city-directory-meta">' + esc(region) + ' • ' + esc(circuit) + '</span></span>' +
        '<span class="city-directory-count">' + item.accounts.length + '</span>';
      cityButton.onclick = () => chooseCity(item);
      host.append(cityButton);
    }

    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = 'Nenhuma cidade encontrada. Confira o nome digitado.';
      host.append(empty);
    }
  }

  function renderSelectedCity(item) {
    document.getElementById('cityDirectorySuggestionsTitle').textContent = '';
    document.getElementById('cityDirectorySuggestions').replaceChildren();

    const all = item.accounts.slice();
    const elite = all.filter(a => a.elite).length;
    const countA = all.filter(a => a.priority === 'A').length;
    const countB = all.filter(a => a.priority === 'B').length;
    const countC = all.filter(a => a.priority === 'C').length;
    const region = CONFIG.regions[item.regionKey];
    const circuit = circuitOf(item.name);
    const context = document.getElementById('cityDirectoryContext');
    context.innerHTML =
      '<div class="card city-directory-summary region-card"><h3>' + esc(item.name) + '</h3>' +
      '<div class="muted">' + esc(region?.name || 'Região a definir') + ' • ' +
      esc(circuit?.name || 'Circuito a definir') + '</div>' +
      '<div class="grid cols4" style="margin-top:12px">' +
      '<div class="kpi"><div class="n">' + all.length + '</div><div class="l">Clientes</div></div>' +
      '<div class="kpi"><div class="n">' + elite + '</div><div class="l">Elite</div></div>' +
      '<div class="kpi"><div class="n">' + countA + '</div><div class="l">Prioridade A</div></div>' +
      '<div class="kpi"><div class="n">' + (countB + countC) + '</div><div class="l">Prioridades B/C</div></div>' +
      '</div><div class="btnrow" id="cityDirectorySummaryActions"></div></div>';

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn small';
    add.textContent = '＋ Novo cliente nesta cidade';
    add.onclick = () => openNewAccount(item);
    document.getElementById('cityDirectorySummaryActions').append(add);

    let filtered = all;
    const priority = prioritySelect.value;
    const segment = segmentSelect.value;
    if (priority === 'ELITE') filtered = filtered.filter(a => a.elite);
    else if (priority !== 'ALL') filtered = filtered.filter(a => a.priority === priority);
    if (segment !== 'ALL') filtered = filtered.filter(a => a.segment === segment);
    filtered.sort((a, b) => Number(b.elite) - Number(a.elite) || score(b) - score(a) ||
      a.company.localeCompare(b.company, 'pt-BR'));

    document.getElementById('cityDirectoryResultsTitle').textContent =
      filtered.length + (filtered.length === 1 ? ' cliente exibido' : ' clientes exibidos');
    document.getElementById('cityDirectoryResults').innerHTML = filtered.length
      ? filtered.map(a => accountCard(a)).join('')
      : '<div class="empty">Nenhum cliente corresponde aos filtros selecionados.</div>';
  }

  function renderCityDirectory() {
    const items = catalog();
    refreshDatalist(items);
    const query = normKey(searchInput.value);
    const exact = items.find(item => item.key === query);
    if (exact) selectedCityKey = exact.key;
    else if (selectedCityKey && selectedCityKey !== query) selectedCityKey = '';

    const selected = items.find(item => item.key === selectedCityKey);
    if (selected) {
      renderSelectedCity(selected);
      return;
    }

    document.getElementById('cityDirectoryContext').innerHTML =
      '<div class="notice">Digite parte do nome ou toque em uma cidade abaixo. O número à direita mostra quantos clientes estão cadastrados.</div>';
    document.getElementById('cityDirectoryResultsTitle').textContent = '';
    document.getElementById('cityDirectoryResults').replaceChildren();
    renderCitySuggestions(items, query);
  }

  searchInput.addEventListener('input', () => {
    selectedCityKey = '';
    renderCityDirectory();
  });
  prioritySelect.addEventListener('change', renderCityDirectory);
  segmentSelect.addEventListener('change', renderCityDirectory);
  document.getElementById('cityDirectoryClear').onclick = () => {
    selectedCityKey = '';
    searchInput.value = '';
    prioritySelect.value = 'ALL';
    segmentSelect.value = 'ALL';
    renderCityDirectory();
  };
  document.getElementById('cityDirectoryBack').onclick = () => showSection('accounts');

  const previousShowCityDirectory = showSection;
  showSection = function(id) {
    previousShowCityDirectory(id);
    if (id === 'cityDirectory') {
      document.querySelector('.nav [data-section="accounts"]')?.classList.add('active');
      renderCityDirectory();
    }
  };

  const previousRenderCityDirectory = renderAll;
  renderAll = function() {
    previousRenderCityDirectory();
    if (section.classList.contains('active')) renderCityDirectory();
  };

  renderCityDirectory();
})();