const fa = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 2 });
const money = n => n == null ? '—' : fa.format(n / 1e10);
const pct = n => n == null || !Number.isFinite(n) ? '—' : `${fa.format(n * 100)}٪`;
const get = (id) => document.getElementById(id);
const monthNames = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
const colors = ['#1776d2','#da9638','#0b9b88'];
let data, selectedYear = 1405, selectedMonth = 'all';

function sum(rows, key) { return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0); }
function sumNullable(rows, key) { return rows.some(row => row[key] != null) ? sum(rows, key) : null; }
function monthName(n) { return monthNames[n - 1] || '—'; }
function filtered(rows) { return rows.filter(row => row.year === selectedYear && (selectedMonth === 'all' || row.month === Number(selectedMonth))); }
function amountCell(value) { return `<td class="amount">${money(value)}</td>`; }
function rate(actual, plan) { return actual == null || !plan ? null : actual / plan; }
function currentCutoff(rows) { return selectedMonth === 'all' ? Math.max(0, ...rows.map(row => row.month)) : Number(selectedMonth); }

function groupedBars(target, items, series, compact = false) {
  const host = get(target);
  if (!items.length) { host.innerHTML = '<div class="empty-state">برای این سال داده‌ای در مدل موجود نیست.</div>'; return; }
  const width = Math.max(620, items.length * (compact ? 68 : 76)), height = compact ? 270 : 310;
  const margin = { top: 24, right: 20, bottom: 52, left: 58 };
  const plotW = width - margin.left - margin.right, plotH = height - margin.top - margin.bottom;
  const vals = items.flatMap(item => series.map(s => item[s.key])).filter(v => Number.isFinite(v));
  const minV = Math.min(0, ...vals), maxV = Math.max(0, ...vals);
  const span = Math.max(1, maxV - minV), low = minV - span * .08, high = maxV + span * .08;
  const y = value => margin.top + (high - value) / (high - low) * plotH;
  const zeroY = y(0), slot = plotW / items.length, barW = Math.min(18, slot / (series.length + 1));
  let svg = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="نمودار میله‌ای مقایسه ماهانه">`;
  for (let i = 0; i <= 4; i++) {
    const value = high - (high - low) * i / 4, gy = y(value), baseline = Math.abs(value) < span * .01;
    svg += `<line x1="${margin.left}" y1="${gy}" x2="${width - margin.right}" y2="${gy}" stroke="${baseline ? '#b8c8d8' : '#e4ebf2'}" stroke-width="${baseline ? 1.4 : 1}"/>`;
    svg += `<text x="${margin.left - 8}" y="${gy + 4}" text-anchor="end" fill="#73869b" font-size="10">${fa.format(value)}</text>`;
  }
  items.forEach((item, i) => {
    const cx = margin.left + slot * (i + .5);
    series.forEach((s, j) => {
      const value = item[s.key]; if (!Number.isFinite(value)) return;
      const barX = cx + (j - (series.length - 1) / 2) * (barW + 3) - barW / 2;
      const barY = Math.min(y(value), zeroY), barH = Math.max(1, Math.abs(zeroY - y(value)));
      svg += `<rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="2" fill="${s.color}" opacity=".92"><title>${monthName(item.month)} · ${s.label}: ${money(value)} میلیارد تومان</title></rect>`;
    });
    svg += `<text x="${cx}" y="${height - 18}" text-anchor="middle" fill="#647b93" font-size="10">${monthName(item.month)}</text>`;
  });
  svg += '</svg>';
  host.innerHTML = svg;
}

function renderPnl() {
  const rows = filtered(data.pnl), cutoff = currentCutoff(data.pnl.filter(row => row.year === selectedYear));
  const ytd = data.pnl.filter(row => row.year === selectedYear && row.month <= cutoff);
  const periodRows = selectedMonth === 'all' ? ytd : rows;
  const revenue = sum(periodRows, 'revenue'), expenses = sum(periodRows, 'expenses');
  get('pnl-revenue').textContent = money(revenue);
  get('pnl-expenses').textContent = money(-expenses);
  get('pnl-profit').textContent = money(revenue + expenses);
  get('pnl-period').textContent = selectedMonth === 'all' ? `جمع عملکرد تا ${monthName(cutoff)}` : `عملکرد ${monthName(selectedMonth)}`;
  const chartRows = data.pnl.filter(row => row.year === selectedYear && (selectedMonth === 'all' || row.month === Number(selectedMonth)));
  groupedBars('pnl-chart', chartRows.map(row => ({month:row.month,revenue:row.revenue/1e10,expenses:-row.expenses/1e10,profit:(row.revenue+row.expenses)/1e10})), [
    {key:'revenue',label:'درآمد',color:colors[0]}, {key:'expenses',label:'هزینه',color:colors[1]}, {key:'profit',label:'سود / زیان',color:colors[2]}
  ]);
  const tableRows = selectedMonth === 'all' ? data.pnl.filter(row => row.year === selectedYear) : rows;
  get('pnl-monthly').innerHTML = tableRows.map(row => `<tr><td>${monthName(row.month)}</td>${amountCell(row.revenue)}${amountCell(-row.expenses)}${amountCell(row.revenue+row.expenses)}</tr>`).join('') || '<tr><td colspan="4" class="empty-note">داده‌ای موجود نیست.</td></tr>';
}

function renderBudget() {
  const all = data.budget.filter(row => row.year === selectedYear);
  const cut = currentCutoff(all.filter(row => row.actualRevenue !== null));
  const active = selectedMonth === 'all' ? all.filter(row => row.month <= cut) : all.filter(row => row.month === Number(selectedMonth));
  const revPlan = sum(active,'revenue'), expPlan = -sum(active,'expenses');
  const revActual = sumNullable(active,'actualRevenue'), expActualRaw = sumNullable(active,'actualExpenses');
  const expActual = expActualRaw == null ? null : -expActualRaw;
  const profitPlan = revPlan - expPlan, profitActual = revActual == null ? null : revActual - expActual;
  get('revenue-achievement').textContent = pct(rate(revActual,revPlan));
  get('expense-achievement').textContent = pct(rate(expActual,expPlan));
  get('budget-actual-profit').textContent = money(profitActual);
  get('profit-variance').textContent = money(profitActual == null ? null : profitActual-profitPlan);
  get('budget-period').textContent = !all.length
    ? `اطلاعات بودجه برای سال ${fa.format(selectedYear)} در مدل موجود نیست`
    : selectedMonth === 'all' ? `بودجه و عملکرد تا ${monthName(cut || 12)}` : `مقایسهٔ ${monthName(selectedMonth)}`;
  const chartRows = selectedMonth === 'all' ? all : all.filter(row => row.month === Number(selectedMonth));
  const chart = (key, expense=false, profit=false) => chartRows.map(row => {
    const plan = profit ? row.revenue + row.expenses : (expense ? -row.expenses : row.revenue);
    const actual = profit ? (row.actualRevenue == null ? null : row.actualRevenue + row.actualExpenses) : (expense ? (row.actualExpenses == null ? null : -row.actualExpenses) : row.actualRevenue);
    return {month:row.month, plan:plan/1e10, actual:actual == null ? null : actual/1e10};
  });
  const series = [{key:'plan',label:'بودجه',color:'#b7c4d3'},{key:'actual',label:'عملکرد',color:colors[0]}];
  groupedBars('revenue-chart',chart('revenue'),series,true);
  groupedBars('expense-chart',chart('expenses',true),series,true);
  groupedBars('profit-chart',chart('profit',false,true),series,true);
  const tableRows = selectedMonth === 'all' ? all : all.filter(row => row.month === Number(selectedMonth));
  const rowHtml = row => {
    const rp=row.revenue, ra=row.actualRevenue, ep=-row.expenses, ea=row.actualExpenses == null ? null : -row.actualExpenses;
    const bp=rp-ep, ba=ra == null ? null : ra-ea;
    return `<tr><td>${monthName(row.month)}</td>${amountCell(rp)}${amountCell(ra)}<td class="amount">${pct(rate(ra,rp))}</td>${amountCell(ra==null?null:ra-rp)}<td class="group-start amount">${money(ep)}</td>${amountCell(ea)}<td class="amount">${pct(rate(ea,ep))}</td>${amountCell(ea==null?null:ea-ep)}<td class="group-start amount">${money(bp)}</td>${amountCell(ba)}<td class="amount">${pct(rate(ba,bp))}</td>${amountCell(ba==null?null:ba-bp)}</tr>`;
  };
  const totalLabel = selectedMonth === 'all' ? `جمع تا ${monthName(cut || 0)}` : `جمع ${monthName(Number(selectedMonth))}`;
  const total = `<tr class="total-row"><td>${totalLabel}</td>${amountCell(revPlan)}${amountCell(revActual)}<td class="amount">${pct(rate(revActual,revPlan))}</td>${amountCell(revActual==null?null:revActual-revPlan)}<td class="group-start amount">${money(expPlan)}</td>${amountCell(expActual)}<td class="amount">${pct(rate(expActual,expPlan))}</td>${amountCell(expActual==null?null:expActual-expPlan)}<td class="group-start amount">${money(profitPlan)}</td>${amountCell(profitActual)}<td class="amount">${pct(rate(profitActual,profitPlan))}</td>${amountCell(profitActual==null?null:profitActual-profitPlan)}</tr>`;
  get('budget-monthly').innerHTML = all.length ? `${tableRows.map(rowHtml).join('')}${total}` : '<tr><td colspan="13" class="empty-note">برای این سال بودجه‌ای در مدل موجود نیست.</td></tr>';
}

function render() {
  renderPnl(); renderBudget();
  const cutoff = selectedMonth === 'all' ? 'همهٔ ماه‌ها' : monthName(Number(selectedMonth));
  get('header-period').textContent = `سال مالی ${fa.format(selectedYear)} · ${cutoff}`;
  const latest = data.pnl.reduce((last, row) => !last || row.year > last.year || (row.year === last.year && row.month > last.month) ? row : last, null);
  const extracted = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {year:'numeric',month:'numeric',day:'numeric',timeZone:'Asia/Tehran'}).format(new Date(data.extractedAt));
  get('freshness').textContent = latest
    ? `آخرین عملکرد مدل: ${fa.format(latest.year)} / ${monthName(latest.month)} · استخراج ${extracted}`
    : `داده‌ای در مدل موجود نیست · استخراج ${extracted}`;
}

function setup() {
  const yearSelect=get('year-select');
  [...data.years].sort((a,b)=>b-a).forEach(year=>yearSelect.add(new Option(fa.format(year),String(year))));
  yearSelect.value='1405';
  const monthSelect=get('month-select');
  monthSelect.add(new Option('همه ماه‌ها','all'));
  monthNames.forEach((name,index)=>monthSelect.add(new Option(name,String(index+1))));
  monthSelect.value='all';
  yearSelect.addEventListener('change',()=>{selectedYear=Number(yearSelect.value);render();});
  monthSelect.addEventListener('change',()=>{selectedMonth=monthSelect.value;render();});
  document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>{
    document.querySelectorAll('.nav-item,.view').forEach(node=>node.classList.remove('active'));
    button.classList.add('active'); get(button.dataset.view).classList.add('active');
    button.setAttribute('aria-current','page');
    document.querySelectorAll('.nav-item').forEach(other=>{if(other!==button)other.removeAttribute('aria-current');});
    get('page-title').textContent=button.dataset.title;get('section-path').textContent=button.dataset.title;
  }));
  render();
}

fetch('data/dashboard-data.json').then(response=>{if(!response.ok)throw new Error('data unavailable');return response.json();}).then(json=>{data=json;setup();}).catch(()=>{document.querySelector('main').innerHTML='<p class="empty-state">دادهٔ داشبورد بارگذاری نشد؛ فایل را از طریق وب‌سرور محلی اجرا کنید.</p>';});
