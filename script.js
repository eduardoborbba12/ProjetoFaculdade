/* ==================================================================
   PONTOCERTO — script.js
   ------------------------------------------------------------------
   Este arquivo é a camada de front-end completa do sistema.
   Como o projeto foi solicitado como 3 arquivos estáticos (HTML/CSS/JS)
   para rodar direto no VS Code (sem back-end), os dados são
   persistidos no localStorage do navegador, organizados em "tabelas"
   que espelham a estrutura de banco de dados descrita no projeto
   (funcionarios, pontos, escalas, salarios, usuarios, alteracoes).

   ATENÇÃO — USO EM PRODUÇÃO:
   Em um ambiente real de supermercado, estas mesmas telas devem
   conversar com um back-end (Node/PHP/Java etc.) e um banco de dados
   SQL de verdade, com as senhas COM HASH no servidor (bcrypt/argon2),
   autenticação por token/sessão e nenhuma regra de negócio sensível
   rodando só no navegador. Aqui, para fins de demonstração local,
   as senhas são transformadas com SHA-256 (Web Crypto API) antes de
   serem gravadas — melhor do que texto puro, mas não substitui um
   back-end real.
   ================================================================== */

(() => {
"use strict";

/* ==================================================================
   1. UTILITÁRIOS GERAIS
   ================================================================== */
const $ = (sel, ctx=document) => ctx.querySelector(sel);
const $all = (sel, ctx=document) => Array.from(ctx.querySelectorAll(sel));

const uid = (prefixo="id") => `${prefixo}_${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;

async function hashSenha(texto){
  const buf = new TextEncoder().encode(texto);
  const hashBuf = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function isoDate(d){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function hoje(){ return isoDate(new Date()); }
function addDias(iso, n){ const d=new Date(iso+"T00:00:00"); d.setDate(d.getDate()+n); return isoDate(d); }
function diaSemanaChave(iso){ return ["dom","seg","ter","qua","qui","sex","sab"][new Date(iso+"T00:00:00").getDay()]; }

function fmtDataBR(iso){ if(!iso) return "—"; const [y,m,d]=iso.split("-"); return `${d}/${m}/${y}`; }
function fmtDiaMesExtenso(iso){
  const d = new Date(iso+"T00:00:00");
  return d.toLocaleDateString("pt-BR",{weekday:"long", day:"2-digit", month:"long", year:"numeric"});
}
function fmtMoney(v){ return (v||0).toLocaleString("pt-BR",{style:"currency", currency:"BRL"}); }

function toMin(hhmm){ if(!hhmm) return null; const [h,m]=hhmm.split(":").map(Number); return h*60+m; }
function toHHMM(min){ if(min==null || isNaN(min)) return "—"; const s=min<0?"-":""; min=Math.abs(Math.round(min)); return `${s}${String(Math.floor(min/60)).padStart(2,"0")}:${String(min%60).padStart(2,"0")}`; }
function fmtHorasMin(min){
  if(min==null || isNaN(min)) return "—h";
  const s = min<0 ? "-" : "";
  min = Math.abs(Math.round(min));
  return `${s}${Math.floor(min/60)}h${String(min%60).padStart(2,"0")}`;
}

function iniciais(nome){
  return (nome||"?").trim().split(/\s+/).slice(0,2).map(p=>p[0]?.toUpperCase()||"").join("");
}

function toast(msg, tipo="sucesso"){
  const cont = $("#toast-container");
  const el = document.createElement("div");
  el.className = `toast ${tipo}`;
  const icone = tipo==="erro" ? "fa-circle-exclamation" : "fa-circle-check";
  el.innerHTML = `<i class="fa-solid ${icone}"></i><span>${msg}</span>`;
  cont.appendChild(el);
  setTimeout(()=>{ el.style.opacity="0"; el.style.transition="opacity .25s"; setTimeout(()=>el.remove(),250); }, 3200);
}

function abrirModal(id){ $("#"+id).classList.remove("oculto"); }
function fecharModal(id){ $("#"+id).classList.add("oculto"); }
$all("[data-fechar-modal]").forEach(btn=>{
  btn.addEventListener("click", ()=>fecharModal(btn.dataset.fecharModal));
});
$all(".modal-overlay").forEach(overlay=>{
  overlay.addEventListener("click", (e)=>{ if(e.target===overlay) overlay.classList.add("oculto"); });
});

function confirmar(titulo, texto, aoConfirmar){
  $("#modal-confirmar-titulo").textContent = titulo;
  $("#modal-confirmar-texto").textContent = texto;
  abrirModal("modal-confirmar-overlay");
  const btn = $("#modal-confirmar-btn");
  const novoBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(novoBtn, btn);
  novoBtn.addEventListener("click", ()=>{
    fecharModal("modal-confirmar-overlay");
    aoConfirmar();
  });
}

/* ==================================================================
   2. CAMADA DE "BANCO DE DADOS" (localStorage)
   ================================================================== */
const DB_KEY = "pontocerto_db_v1";
const SESSAO_KEY = "pontocerto_sessao_v1";

const DIAS_ORDEM = ["seg","ter","qua","qui","sex","sab","dom"];
const DIAS_LABEL = {seg:"Segunda-feira", ter:"Terça-feira", qua:"Quarta-feira", qui:"Quinta-feira", sex:"Sexta-feira", sab:"Sábado", dom:"Domingo"};
const FERIADOS = new Set(["01-01","04-21","05-01","09-07","10-12","11-02","11-15","12-25"]); // MM-DD fixos, uso demonstrativo

let DB = null;

function salvarDB(){ localStorage.setItem(DB_KEY, JSON.stringify(DB)); }
function carregarDB(){
  const raw = localStorage.getItem(DB_KEY);
  DB = raw ? JSON.parse(raw) : null;
}

function escalaVazia(){
  const dias = {};
  DIAS_ORDEM.forEach(d => dias[d] = {ativo:false, entrada:"", saidaIntervalo:"", retorno:"", saida:""});
  return dias;
}

function aplicarModeloEscala(dias, modelo){
  DIAS_ORDEM.forEach(d => dias[d] = {ativo:false, entrada:"", saidaIntervalo:"", retorno:"", saida:""});
  if(modelo==="5x2"){
    ["seg","ter","qua","qui","sex"].forEach(d=> dias[d]={ativo:true, entrada:"08:00", saidaIntervalo:"12:00", retorno:"13:00", saida:"18:00"});
  } else if(modelo==="6x1"){
    ["seg","ter","qua","qui","sex","sab"].forEach(d=> dias[d]={ativo:true, entrada:"08:00", saidaIntervalo:"12:00", retorno:"13:00", saida:"17:00"});
  }
  return dias;
}

async function seedInicial(){
  DB = {
    funcionarios: [],
    escalas: {},      // funcionarioId -> {seg:{...}, ter:{...}, ...}
    pontos: [],        // {id, funcionarioId, data, entrada, saidaIntervalo, retornoIntervalo, saida}
    alteracoes: [],
    config: { tolerancia: 5, jornadaPadrao: 8 },
    adminSenhaHash: await hashSenha("admin123")
  };

  const funcionariosSeed = [
    {nome:"Ana Beatriz Souza", matricula:"1001", cargo:"Operadora de Caixa", telefone:"(51) 99811-2233", email:"ana.souza@mercado.com", salario:1800, contrato:"CLT", status:"Ativo", senha:"1234", modelo:"5x2", horario:["08:00","12:00","13:00","18:00"]},
    {nome:"Carlos Eduardo Lima", matricula:"1002", cargo:"Repositor", telefone:"(51) 99822-3344", email:"carlos.lima@mercado.com", salario:1700, contrato:"CLT", status:"Ativo", senha:"1234", modelo:"6x1", horario:["07:00","12:00","13:00","16:00"]},
    {nome:"Fernanda Oliveira", matricula:"1003", cargo:"Fiscal de Caixa", telefone:"(51) 99833-4455", email:"fernanda.oliveira@mercado.com", salario:2100, contrato:"CLT", status:"Ativo", senha:"1234", modelo:"5x2", horario:["09:00","13:00","14:00","19:00"]},
    {nome:"Juliana Pereira", matricula:"1004", cargo:"Açougueira", telefone:"(51) 99844-5566", email:"juliana.pereira@mercado.com", salario:1950, contrato:"CLT", status:"Inativo", senha:"1234", modelo:"5x2", horario:["06:00","10:00","11:00","15:00"]},
    {nome:"Rafael Santos", matricula:"1005", cargo:"Gerente de Loja", telefone:"(51) 99855-6677", email:"rafael.santos@mercado.com", salario:3600, contrato:"CLT", status:"Ativo", senha:"1234", modelo:"5x2", horario:["08:00","12:00","13:00","18:00"]},
  ];

  for(const f of funcionariosSeed){
    const id = uid("f");
    DB.funcionarios.push({
      id, nome:f.nome, matricula:f.matricula, cpf:"", cargo:f.cargo, telefone:f.telefone, email:f.email,
      senhaHash: await hashSenha(f.senha), dataAdmissao: "2023-03-01", salario: f.salario,
      tipoContrato: f.contrato, status: f.status, observacoes:"",
      jornadaDiaria: 8, jornadaSemanal: f.modelo==="6x1" ? 44 : 40, percentualHoraExtra: 50, adicionalNoturno:false
    });
    const dias = aplicarModeloEscala(escalaVazia(), f.modelo);
    // aplica horário customizado do funcionário sobre os dias ativos do modelo
    Object.keys(dias).forEach(k=>{
      if(dias[k].ativo){ dias[k] = {ativo:true, entrada:f.horario[0], saidaIntervalo:f.horario[1], retorno:f.horario[2], saida:f.horario[3]}; }
    });
    DB.escalas[id] = dias;
  }

  // Gera ~25 dias úteis de pontos retroativos, com variações realistas (atrasos, faltas, horas extras)
  const ativos = DB.funcionarios.filter(f=>f.status==="Ativo");
  for(const f of ativos){
    const escala = DB.escalas[f.id];
    let cursor = addDias(hoje(), -34);
    let diasGerados = 0;
    while(diasGerados < 24 && cursor < hoje()){
      const chave = diaSemanaChave(cursor);
      const diaEscala = escala[chave];
      if(diaEscala && diaEscala.ativo){
        diasGerados++;
        const sorte = Math.random();
        if(sorte < 0.08){
          // falta
        } else {
          const atrasoMin = sorte < 0.25 ? Math.floor(Math.random()*22) : 0;
          const saidaAntecipMin = sorte > 0.9 ? Math.floor(Math.random()*15) : 0;
          const extraMin = sorte > 0.75 && sorte <= 0.9 ? Math.floor(Math.random()*40) : 0;
          const entrada = toHHMM(toMin(diaEscala.entrada)+atrasoMin);
          const saidaIntervalo = diaEscala.saidaIntervalo;
          const retorno = diaEscala.retorno;
          const saida = toHHMM(toMin(diaEscala.saida)+extraMin-saidaAntecipMin);
          DB.pontos.push({id:uid("p"), funcionarioId:f.id, data:cursor, entrada, saidaIntervalo, retornoIntervalo:retorno, saida, observacao:""});
        }
      }
      cursor = addDias(cursor, 1);
    }
  }

  salvarDB();
}

function db(){ return DB; }
function getFuncionario(id){ return DB.funcionarios.find(f=>f.id===id); }
function getEscala(id){ return DB.escalas[id] || escalaVazia(); }
function pontosDoFuncionario(id){ return DB.pontos.filter(p=>p.funcionarioId===id).sort((a,b)=>b.data.localeCompare(a.data)); }
function pontoDoDia(funcionarioId, data){ return DB.pontos.find(p=>p.funcionarioId===funcionarioId && p.data===data); }

function registrarAlteracao(acao, registro, antes, depois){
  DB.alteracoes.unshift({
    id: uid("h"), dataHora: new Date().toISOString(),
    usuario: SESSAO ? `${SESSAO.nome} (${SESSAO.tipo==="admin"?"Administrador":"Funcionário"})` : "Sistema",
    acao, registro,
    antes: antes ? JSON.stringify(antes) : "—",
    depois: depois ? JSON.stringify(depois) : "—"
  });
  salvarDB();
}

/* ==================================================================
   3. CÁLCULO DE HORAS / STATUS DE PONTO
   ================================================================== */
function minutosPrevistos(diaEscala){
  if(!diaEscala || !diaEscala.ativo) return 0;
  let total = 0;
  if(diaEscala.entrada && diaEscala.saidaIntervalo) total += toMin(diaEscala.saidaIntervalo)-toMin(diaEscala.entrada);
  if(diaEscala.retorno && diaEscala.saida) total += toMin(diaEscala.saida)-toMin(diaEscala.retorno);
  if(diaEscala.entrada && diaEscala.saida && !diaEscala.saidaIntervalo && !diaEscala.retorno) total = toMin(diaEscala.saida)-toMin(diaEscala.entrada);
  return Math.max(0,total);
}

function minutosTrabalhados(ponto){
  if(!ponto) return 0;
  let total = 0;
  if(ponto.entrada && ponto.saidaIntervalo) total += toMin(ponto.saidaIntervalo)-toMin(ponto.entrada);
  if(ponto.retornoIntervalo && ponto.saida) total += toMin(ponto.saida)-toMin(ponto.retornoIntervalo);
  if(ponto.entrada && ponto.saida && !ponto.saidaIntervalo && !ponto.retornoIntervalo) total = toMin(ponto.saida)-toMin(ponto.entrada);
  return Math.max(0,total);
}

/** Retorna o status completo de um funcionário em um dia específico. */
function statusDoDia(funcionarioId, dataISO){
  const f = getFuncionario(funcionarioId);
  const diaEscala = getEscala(funcionarioId)[diaSemanaChave(dataISO)];
  const ponto = pontoDoDia(funcionarioId, dataISO);
  const tolerancia = DB.config.tolerancia || 0;
  const mmdd = dataISO.slice(5);
  const ehFeriado = FERIADOS.has(mmdd);
  const ehFuturo = dataISO > hoje();

  const previsto = minutosPrevistos(diaEscala);
  const trabalhado = minutosTrabalhados(ponto);

  let situacao = "Folga";
  let atrasoMin = 0, saidaAntecipMin = 0, extraMin = 0;

  if(ehFeriado && previsto===0){ situacao = "Feriado"; }
  else if(!diaEscala || !diaEscala.ativo){ situacao = "Folga"; }
  else if(ehFuturo){ situacao = "Agendado"; }
  else if(!ponto || !ponto.entrada){ situacao = "Falta"; }
  else {
    situacao = "Trabalhou";
    if(diaEscala.entrada && ponto.entrada){
      const diff = toMin(ponto.entrada) - toMin(diaEscala.entrada);
      if(diff > tolerancia) { atrasoMin = diff; situacao = "Atraso"; }
    }
    if(diaEscala.saida && ponto.saida){
      const diffSaida = toMin(diaEscala.saida) - toMin(ponto.saida);
      if(diffSaida > tolerancia) { saidaAntecipMin = diffSaida; if(situacao==="Trabalhou") situacao = "Saída antecipada"; }
    }
    if(trabalhado > previsto) extraMin = trabalhado - previsto;
  }

  return { situacao, previsto, trabalhado, atrasoMin, saidaAntecipMin, extraMin, ponto, diaEscala, ehFeriado };
}

function badgeSituacao(situacao){
  const map = {
    "Trabalhou": "badge-verde", "Falta": "badge-vermelho", "Atraso": "badge-ambar",
    "Saída antecipada": "badge-ambar", "Folga": "badge-cinza", "Feriado": "badge-azul", "Agendado": "badge-cinza"
  };
  return `<span class="badge ${map[situacao]||"badge-cinza"}">${situacao}</span>`;
}

/* ==================================================================
   4. SESSÃO / LOGIN
   ================================================================== */
let SESSAO = null; // {tipo:'admin'|'funcionario', funcionarioId, nome, cargo, matricula}

function salvarSessao(){ sessionStorage.setItem(SESSAO_KEY, JSON.stringify(SESSAO)); }
function carregarSessao(){ const raw = sessionStorage.getItem(SESSAO_KEY); SESSAO = raw ? JSON.parse(raw) : null; }
function limparSessao(){ SESSAO = null; sessionStorage.removeItem(SESSAO_KEY); }

$("#btn-tipo-funcionario").addEventListener("click", ()=>selecionarTipoLogin("funcionario"));
$("#btn-tipo-admin").addEventListener("click", ()=>selecionarTipoLogin("admin"));
function selecionarTipoLogin(tipo){
  $("#btn-tipo-funcionario").classList.toggle("active", tipo==="funcionario");
  $("#btn-tipo-admin").classList.toggle("active", tipo==="admin");
  $("#form-login").dataset.tipo = tipo;
  $("#login-usuario").placeholder = tipo==="admin" ? "usuário admin" : "Ex.: 1001";
}
$("#form-login").dataset.tipo = "funcionario";

$("#btn-olho-login").addEventListener("click", ()=>{
  const input = $("#login-senha");
  const olho = $("#btn-olho-login i");
  const mostrar = input.type === "password";
  input.type = mostrar ? "text" : "password";
  olho.className = mostrar ? "fa-solid fa-eye-slash" : "fa-solid fa-eye";
});

$("#form-login").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const tipo = $("#form-login").dataset.tipo;
  const usuario = $("#login-usuario").value.trim();
  const senha = $("#login-senha").value;
  const senhaHash = await hashSenha(senha);
  const erroEl = $("#login-erro");
  erroEl.textContent = "";

  if(tipo === "admin"){
    if(usuario === "admin" && senhaHash === DB.adminSenhaHash){
      SESSAO = {tipo:"admin", funcionarioId:null, nome:"Administrador do Sistema", cargo:"Administrador", matricula:"admin"};
      salvarSessao();
      entrarNoApp();
      return;
    }
    erroEl.textContent = "Usuário administrador ou senha incorretos.";
    return;
  }

  const f = DB.funcionarios.find(x=>x.matricula===usuario);
  if(!f){ erroEl.textContent = "Matrícula não encontrada."; return; }
  if(f.status !== "Ativo"){ erroEl.textContent = "Funcionário inativo. Procure o administrador."; return; }
  if(f.senhaHash !== senhaHash){ erroEl.textContent = "Senha incorreta."; return; }

  SESSAO = {tipo:"funcionario", funcionarioId:f.id, nome:f.nome, cargo:f.cargo, matricula:f.matricula};
  salvarSessao();
  entrarNoApp();
});

$("#btn-sair").addEventListener("click", ()=>{
  confirmar("Sair do sistema", "Deseja realmente encerrar sua sessão?", ()=>{
    limparSessao();
    location.reload();
  });
});

/* ==================================================================
   5. MENU LATERAL / NAVEGAÇÃO
   ================================================================== */
const MENU_ADMIN = [
  {pagina:"dashboard", icone:"fa-gauge-high", label:"Dashboard"},
  {pagina:"ponto", icone:"fa-fingerprint", label:"Bater Ponto"},
  {pagina:"funcionarios", icone:"fa-users", label:"Funcionários"},
  {pagina:"escalas", icone:"fa-calendar-days", label:"Escalas"},
  {pagina:"salarios", icone:"fa-sack-dollar", label:"Salários"},
  {pagina:"horas", icone:"fa-business-time", label:"Horas Trabalhadas"},
  {pagina:"controle", icone:"fa-list-check", label:"Controle de Ponto"},
  {pagina:"relatorios", icone:"fa-chart-line", label:"Relatórios"},
  {pagina:"calendario", icone:"fa-calendar", label:"Calendário"},
  {pagina:"historico", icone:"fa-clock-rotate-left", label:"Histórico"},
  {pagina:"configuracoes", icone:"fa-gear", label:"Configurações"},
];
const MENU_FUNCIONARIO = [
  {pagina:"ponto", icone:"fa-fingerprint", label:"Bater Ponto"},
  {pagina:"horas", icone:"fa-business-time", label:"Minhas Horas"},
  {pagina:"calendario", icone:"fa-calendar", label:"Meu Calendário"},
];
const TITULOS = {
  dashboard:["Dashboard","Visão geral do supermercado"],
  ponto:["Bater Ponto","Registre sua entrada, intervalo e saída"],
  funcionarios:["Funcionários","Cadastro e gestão da equipe"],
  escalas:["Escala de Trabalho","Defina os dias e horários de cada funcionário"],
  salarios:["Salários","Remuneração e valores de hora trabalhada"],
  horas:["Horas Trabalhadas","Acompanhamento diário, semanal e mensal"],
  controle:["Controle de Ponto","Consulte e corrija registros"],
  relatorios:["Relatórios","Gere relatórios detalhados por período"],
  calendario:["Calendário","Situação de ponto dia a dia"],
  historico:["Histórico de Alterações","Rastreabilidade de correções no sistema"],
  configuracoes:["Configurações","Preferências do sistema"],
};

function montarMenu(){
  const itens = SESSAO.tipo === "admin" ? MENU_ADMIN : MENU_FUNCIONARIO;
  $("#sidebar-menu").innerHTML = itens.map(i =>
    `<button class="menu-item" data-pagina="${i.pagina}"><i class="fa-solid ${i.icone}"></i> ${i.label}</button>`
  ).join("");
  $all(".menu-item").forEach(btn => btn.addEventListener("click", ()=> irPara(btn.dataset.pagina)));
}

function irPara(pagina){
  $all(".pagina").forEach(p => p.classList.remove("ativa"));
  const alvo = $(`#pagina-${pagina}`);
  if(!alvo) return;
  alvo.classList.add("ativa");
  $all(".menu-item").forEach(b => b.classList.toggle("active", b.dataset.pagina===pagina));
  const [titulo, subtitulo] = TITULOS[pagina] || ["",""];
  $("#pagina-titulo").textContent = titulo;
  $("#pagina-subtitulo").textContent = subtitulo;
  fecharSidebarMobile();

  const renderizadores = {
    dashboard: renderDashboard, ponto: renderPonto, funcionarios: renderFuncionarios,
    escalas: renderEscalas, salarios: renderSalarios, horas: renderHoras,
    controle: renderControle, relatorios: renderRelatorios, calendario: renderCalendario,
    historico: renderHistorico, configuracoes: renderConfiguracoes
  };
  renderizadores[pagina] && renderizadores[pagina]();
}

$("#btn-menu-mobile").addEventListener("click", ()=>{
  $("#sidebar").classList.add("aberta");
  $("#sidebar-overlay").classList.add("ativa");
});
$("#btn-fechar-sidebar").addEventListener("click", fecharSidebarMobile);
$("#sidebar-overlay").addEventListener("click", fecharSidebarMobile);
function fecharSidebarMobile(){ $("#sidebar").classList.remove("aberta"); $("#sidebar-overlay").classList.remove("ativa"); }

/* ==================================================================
   6. ENTRADA NO APP / RELÓGIO
   ================================================================== */
function entrarNoApp(){
  $("#tela-login").classList.add("oculto");
  $("#app").classList.remove("oculto");
  $("#sidebar-avatar").textContent = iniciais(SESSAO.nome);
  $("#sidebar-usuario-nome").textContent = SESSAO.nome;
  $("#sidebar-usuario-cargo").textContent = SESSAO.tipo==="admin" ? "Administrador" : SESSAO.cargo;
  montarMenu();
  irPara(SESSAO.tipo==="admin" ? "dashboard" : "ponto");
  atualizarRelogios();
  setInterval(atualizarRelogios, 1000);
}

function atualizarRelogios(){
  const agora = new Date();
  const hhmmss = agora.toLocaleTimeString("pt-BR");
  const elTop = $("#topbar-relogio"); if(elTop) elTop.textContent = hhmmss;
  const elPonto = $("#ponto-relogio"); if(elPonto) elPonto.textContent = hhmmss;
}

/* ==================================================================
   7. DASHBOARD
   ================================================================== */
let graficoHorasFunc=null, graficoHorasExtras=null;

function renderDashboard(){
  const ativos = DB.funcionarios.filter(f=>f.status==="Ativo");
  const dataHoje = hoje();
  let presentes=0, ausentes=0, emIntervalo=0, extrasHoje=0;
  let horasHojeMin=0, horasSemanaMin=0, horasMesMin=0, extrasSemanaMin=0;

  const inicioSemana = addDias(dataHoje, -((new Date(dataHoje+"T00:00:00").getDay()+6)%7));
  const inicioMes = dataHoje.slice(0,8)+"01";

  ativos.forEach(f=>{
    const st = statusDoDia(f.id, dataHoje);
    if(st.situacao==="Trabalhou" || st.situacao==="Atraso" || st.situacao==="Saída antecipada"){
      const p = st.ponto;
      if(p && p.entrada && !p.saida){
        if(p.saidaIntervalo && !p.retornoIntervalo) emIntervalo++; else presentes++;
      } else if(p && p.saida){ presentes++; }
    } else if(st.situacao==="Falta"){ ausentes++; }
    horasHojeMin += st.trabalhado;
    extrasHoje += st.extraMin;

    // acumula semana/mês
    let cursor = inicioSemana;
    while(cursor <= dataHoje){
      const s = statusDoDia(f.id, cursor);
      horasSemanaMin += s.trabalhado; extrasSemanaMin += s.extraMin;
      cursor = addDias(cursor,1);
    }
    cursor = inicioMes;
    while(cursor <= dataHoje){
      const s = statusDoDia(f.id, cursor);
      horasMesMin += s.trabalhado;
      cursor = addDias(cursor,1);
    }
  });

  const cards = [
    {label:"Funcionários ativos", valor: ativos.length, icone:"fa-users", cor:"var(--primary)"},
    {label:"Presentes hoje", valor: presentes, icone:"fa-user-check", cor:"var(--info)"},
    {label:"Ausentes hoje", valor: ausentes, icone:"fa-user-xmark", cor:"var(--danger)"},
    {label:"Em intervalo", valor: emIntervalo, icone:"fa-mug-hot", cor:"var(--amber)"},
    {label:"Horas trabalhadas hoje", valor: fmtHorasMin(horasHojeMin), icone:"fa-clock", cor:"var(--primary)"},
    {label:"Horas trabalhadas na semana", valor: fmtHorasMin(horasSemanaMin), icone:"fa-calendar-week", cor:"var(--info)"},
    {label:"Horas trabalhadas no mês", valor: fmtHorasMin(horasMesMin), icone:"fa-calendar-days", cor:"var(--primary)"},
    {label:"Horas extras (semana)", valor: fmtHorasMin(extrasSemanaMin), icone:"fa-bolt", cor:"var(--amber)"},
  ];
  $("#dash-cards").innerHTML = cards.map(c => `
    <div class="card-metric" style="--card-cor:${c.cor}">
      <div class="card-metric-topo">
        <div class="card-metric-icone"><i class="fa-solid ${c.icone}"></i></div>
      </div>
      <strong>${c.valor}</strong>
      <span>${c.label}</span>
    </div>
  `).join("");

  // Gráficos: horas trabalhadas por funcionário (semana) e horas extras
  const labels = ativos.map(f=>f.nome.split(" ")[0]);
  const horasPorFunc = ativos.map(f=>{
    let total=0, cursor=inicioSemana;
    while(cursor<=dataHoje){ total += statusDoDia(f.id, cursor).trabalhado; cursor=addDias(cursor,1); }
    return +(total/60).toFixed(1);
  });
  const extrasPorFunc = ativos.map(f=>{
    let total=0, cursor=inicioSemana;
    while(cursor<=dataHoje){ total += statusDoDia(f.id, cursor).extraMin; cursor=addDias(cursor,1); }
    return +(total/60).toFixed(1);
  });

  if(typeof Chart !== "undefined"){
    const ctx1 = $("#graf-horas-funcionario");
    const ctx2 = $("#graf-horas-extras");
    if(graficoHorasFunc) graficoHorasFunc.destroy();
    if(graficoHorasExtras) graficoHorasExtras.destroy();
    graficoHorasFunc = new Chart(ctx1, { type:"bar", data:{ labels, datasets:[{label:"Horas", data:horasPorFunc, backgroundColor:"#2E8B57", borderRadius:6}]},
      options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true, ticks:{callback:v=>v+"h"}}} } });
    graficoHorasExtras = new Chart(ctx2, { type:"bar", data:{ labels, datasets:[{label:"Horas extras", data:extrasPorFunc, backgroundColor:"#D98C0E", borderRadius:6}]},
      options:{ plugins:{legend:{display:false}}, scales:{y:{beginAtZero:true, ticks:{callback:v=>v+"h"}}} } });
  }

  // Rankings
  const rankingHoras = ativos.map(f=>{
    let total=0, cursor=inicioMes;
    while(cursor<=dataHoje){ total += statusDoDia(f.id, cursor).trabalhado; cursor=addDias(cursor,1); }
    return {nome:f.nome, total};
  }).sort((a,b)=>b.total-a.total).slice(0,5);
  $("#ranking-horas").innerHTML = rankingHoras.map((r,i)=>`
    <div class="ranking-item"><span class="ranking-pos">${i+1}</span><strong>${r.nome}</strong><span>${fmtHorasMin(r.total)}</span></div>
  `).join("") || `<p class="texto-muted">Sem dados suficientes.</p>`;

  const rankingProblemas = ativos.map(f=>{
    let atrasos=0, faltas=0, cursor=inicioMes;
    while(cursor<=dataHoje){ const s=statusDoDia(f.id,cursor); if(s.situacao==="Atraso") atrasos++; if(s.situacao==="Falta") faltas++; cursor=addDias(cursor,1); }
    return {nome:f.nome, atrasos, faltas, total:atrasos+faltas};
  }).filter(r=>r.total>0).sort((a,b)=>b.total-a.total).slice(0,5);
  $("#ranking-atrasos").innerHTML = rankingProblemas.map((r)=>`
    <div class="ranking-item"><span class="ranking-pos"><i class="fa-solid fa-triangle-exclamation" style="font-size:.65rem"></i></span><strong>${r.nome}</strong><span>${r.atrasos} atraso(s) · ${r.faltas} falta(s)</span></div>
  `).join("") || `<p class="texto-muted">Nenhuma ocorrência este mês. 🎉</p>`;
}

/* ==================================================================
   8. BATER PONTO
   ================================================================== */
function funcionarioAlvoPonto(){
  if(SESSAO.tipo === "funcionario") return getFuncionario(SESSAO.funcionarioId);
  // admin também pode visualizar a tela, mas usamos o primeiro funcionário ativo apenas como preview
  return DB.funcionarios.find(f=>f.status==="Ativo");
}

const SEQUENCIA_TIPOS = [
  {chave:"entrada", label:"Entrada"},
  {chave:"saidaIntervalo", label:"Saída para intervalo"},
  {chave:"retornoIntervalo", label:"Retorno do intervalo"},
  {chave:"saida", label:"Saída"},
];

function proximoRegistro(ponto){
  if(!ponto) return SEQUENCIA_TIPOS[0];
  for(const tipo of SEQUENCIA_TIPOS){ if(!ponto[tipo.chave]) return tipo; }
  return null; // já completo
}

function renderPonto(){
  const f = funcionarioAlvoPonto();
  if(!f){ $("#ponto-nome").textContent = "Nenhum funcionário disponível"; return; }
  const dataHoje = hoje();
  $("#ponto-data").textContent = fmtDiaMesExtenso(dataHoje);
  $("#ponto-avatar").textContent = iniciais(f.nome);
  $("#ponto-nome").textContent = f.nome;
  $("#ponto-matricula").textContent = `Matrícula ${f.matricula} · ${f.cargo}`;

  const ponto = pontoDoDia(f.id, dataHoje);
  const prox = proximoRegistro(ponto);
  const btn = $("#btn-bater-ponto");
  if(!prox){
    $("#ponto-proximo-tipo").textContent = "Jornada concluída";
    btn.disabled = true; btn.style.opacity = 0.5; btn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Ponto do dia completo`;
  } else {
    $("#ponto-proximo-tipo").textContent = prox.label;
    btn.disabled = false; btn.style.opacity = 1; btn.innerHTML = `<i class="fa-solid fa-fingerprint"></i> Bater Ponto — ${prox.label}`;
  }
  btn.dataset.funcionarioId = f.id;

  $("#ponto-registros-hoje").innerHTML = SEQUENCIA_TIPOS.map(t=>{
    const valor = ponto ? ponto[t.chave] : null;
    return `<div class="ponto-registro-linha"><span>${t.label}</span><span>${valor || "—"}</span></div>`;
  }).join("");

  // Histórico
  const registros = pontosDoFuncionario(f.id).slice(0,15);
  $("#tabela-meus-pontos tbody").innerHTML = registros.length ? registros.map(p=>{
    const st = statusDoDia(f.id, p.data);
    return `<tr>
      <td>${fmtDataBR(p.data)}</td><td>${p.entrada||"—"}</td><td>${p.saidaIntervalo||"—"}</td>
      <td>${p.retornoIntervalo||"—"}</td><td>${p.saida||"—"}</td><td>${fmtHorasMin(minutosTrabalhados(p))}</td>
      <td>${badgeSituacao(st.situacao)}</td>
    </tr>`;
  }).join("") : `<tr><td colspan="7" class="tabela-vazia">Nenhum registro ainda.</td></tr>`;
}

$("#btn-bater-ponto").addEventListener("click", ()=>{
  const funcionarioId = $("#btn-bater-ponto").dataset.funcionarioId;
  const ponto = pontoDoDia(funcionarioId, hoje());
  const prox = proximoRegistro(ponto);
  if(!prox) return;
  $("#modal-senha-tipo").textContent = prox.label;
  $("#confirma-senha-input").value = "";
  $("#confirma-senha-erro").textContent = "";
  $("#form-confirma-senha").dataset.funcionarioId = funcionarioId;
  $("#form-confirma-senha").dataset.tipoChave = prox.chave;
  abrirModal("modal-senha-overlay");
  setTimeout(()=> $("#confirma-senha-input").focus(), 50);
});

$("#form-confirma-senha").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const funcionarioId = e.target.dataset.funcionarioId;
  const tipoChave = e.target.dataset.tipoChave;
  const f = getFuncionario(funcionarioId);
  const senhaDigitada = $("#confirma-senha-input").value;
  const hash = await hashSenha(senhaDigitada);

  if(hash !== f.senhaHash){
    $("#confirma-senha-erro").textContent = "Senha incorreta. Tente novamente.";
    return;
  }

  const dataHoje = hoje();
  let ponto = pontoDoDia(funcionarioId, dataHoje);
  if(!ponto){
    ponto = {id:uid("p"), funcionarioId, data:dataHoje, entrada:null, saidaIntervalo:null, retornoIntervalo:null, saida:null, observacao:""};
    DB.pontos.push(ponto);
  }
  // impede registro duplicado/fora de ordem
  const proxEsperado = proximoRegistro(ponto);
  if(!proxEsperado || proxEsperado.chave !== tipoChave){
    $("#confirma-senha-erro").textContent = "Este registro já foi feito ou está fora de ordem.";
    return;
  }
  const agora = new Date().toLocaleTimeString("pt-BR",{hour:"2-digit", minute:"2-digit"});
  ponto[tipoChave] = agora;
  salvarDB();
  fecharModal("modal-senha-overlay");
  toast(`${SEQUENCIA_TIPOS.find(t=>t.chave===tipoChave).label} registrada às ${agora}.`);
  renderPonto();
});

/* ==================================================================
   9. FUNCIONÁRIOS (CRUD)
   ================================================================== */
function renderFuncionarios(){
  const busca = ($("#f-func-busca").value||"").toLowerCase();
  const statusF = $("#f-func-status").value;
  const dataHoje = hoje(); const inicioMes = dataHoje.slice(0,8)+"01";

  let lista = DB.funcionarios.filter(f=>{
    const bate = !busca || f.nome.toLowerCase().includes(busca) || f.matricula.includes(busca) || f.cargo.toLowerCase().includes(busca);
    const bateStatus = !statusF || f.status===statusF;
    return bate && bateStatus;
  });

  $("#tabela-funcionarios tbody").innerHTML = lista.length ? lista.map(f=>{
    let horasMes=0, cursor=inicioMes;
    while(cursor<=dataHoje){ horasMes += statusDoDia(f.id,cursor).trabalhado; cursor=addDias(cursor,1); }
    return `<tr>
      <td><div class="celula-nome"><div class="avatar">${iniciais(f.nome)}</div><span>${f.nome}</span></div></td>
      <td>${f.matricula}</td><td>${f.cargo}</td><td>${fmtMoney(f.salario)}</td>
      <td>${f.status==="Ativo" ? '<span class="badge badge-verde">Ativo</span>' : '<span class="badge badge-cinza">Inativo</span>'}</td>
      <td>${fmtHorasMin(horasMes)}</td>
      <td class="celula-acoes">
        <button class="btn-icone" title="Visualizar" data-acao="ver" data-id="${f.id}"><i class="fa-solid fa-eye"></i></button>
        <button class="btn-icone" title="Editar" data-acao="editar" data-id="${f.id}"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-icone" title="Ver ponto" data-acao="ponto" data-id="${f.id}"><i class="fa-solid fa-fingerprint"></i></button>
        <button class="btn-icone" title="Ver relatório" data-acao="relatorio" data-id="${f.id}"><i class="fa-solid fa-chart-line"></i></button>
        <button class="btn-icone perigo" title="Excluir" data-acao="excluir" data-id="${f.id}"><i class="fa-solid fa-trash"></i></button>
      </td>
    </tr>`;
  }).join("") : `<tr><td colspan="7" class="tabela-vazia">Nenhum funcionário encontrado.</td></tr>`;

  $all("#tabela-funcionarios [data-acao]").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const {acao, id} = btn.dataset;
      if(acao==="ver") verFuncionario(id);
      else if(acao==="editar") editarFuncionario(id);
      else if(acao==="excluir") excluirFuncionario(id);
      else if(acao==="ponto"){ $("#f-controle-funcionario").value=id; irPara("controle"); }
      else if(acao==="relatorio"){ irPara("relatorios"); $("#r-funcionario").value=id; }
    });
  });
}
$("#f-func-busca").addEventListener("input", renderFuncionarios);
$("#f-func-status").addEventListener("change", renderFuncionarios);

$("#btn-novo-funcionario").addEventListener("click", ()=>{
  $("#form-funcionario").reset();
  $("#ff-id").value = "";
  $("#modal-funcionario-titulo").textContent = "Novo funcionário";
  $("#ff-senha-hint").textContent = "*";
  $("#ff-senha").required = true;
  $("#ff-admissao").value = hoje();
  abrirModal("modal-funcionario-overlay");
});

function editarFuncionario(id){
  const f = getFuncionario(id);
  $("#form-funcionario").reset();
  $("#ff-id").value = f.id;
  $("#ff-nome").value = f.nome; $("#ff-matricula").value = f.matricula; $("#ff-cargo").value = f.cargo;
  $("#ff-telefone").value = f.telefone||""; $("#ff-email").value = f.email||"";
  $("#ff-admissao").value = f.dataAdmissao; $("#ff-salario").value = f.salario;
  $("#ff-contrato").value = f.tipoContrato; $("#ff-status").value = f.status;
  $("#ff-observacoes").value = f.observacoes||"";
  $("#ff-senha").required = false;
  $("#ff-senha-hint").textContent = "(opcional)";
  $("#modal-funcionario-titulo").textContent = "Editar funcionário";
  abrirModal("modal-funcionario-overlay");
}

function verFuncionario(id){
  const f = getFuncionario(id);
  const dataHoje = hoje(); const inicioMes = dataHoje.slice(0,8)+"01";
  let horasMes=0, cursor=inicioMes;
  while(cursor<=dataHoje){ horasMes += statusDoDia(f.id,cursor).trabalhado; cursor=addDias(cursor,1); }
  $("#modal-visualizar-corpo").innerHTML = `
    <div class="perfil-cabecalho">
      <div class="avatar avatar-lg">${iniciais(f.nome)}</div>
      <div><strong>${f.nome}</strong><span>${f.cargo} · Matrícula ${f.matricula}</span></div>
    </div>
    <div class="perfil-grid">
      <div><b>CPF/Matrícula</b>${f.matricula}</div>
      <div><b>Status</b>${f.status}</div>
      <div><b>Telefone</b>${f.telefone||"—"}</div>
      <div><b>E-mail</b>${f.email||"—"}</div>
      <div><b>Admissão</b>${fmtDataBR(f.dataAdmissao)}</div>
      <div><b>Contrato</b>${f.tipoContrato}</div>
      <div><b>Salário mensal</b>${fmtMoney(f.salario)}</div>
      <div><b>Horas trabalhadas (mês)</b>${fmtHorasMin(horasMes)}</div>
      <div style="grid-column:span 2"><b>Observações</b>${f.observacoes||"—"}</div>
    </div>`;
  abrirModal("modal-visualizar-overlay");
}

function excluirFuncionario(id){
  const f = getFuncionario(id);
  confirmar("Excluir funcionário", `Tem certeza que deseja excluir ${f.nome}? Os registros de ponto associados também serão removidos.`, ()=>{
    DB.funcionarios = DB.funcionarios.filter(x=>x.id!==id);
    DB.pontos = DB.pontos.filter(p=>p.funcionarioId!==id);
    delete DB.escalas[id];
    registrarAlteracao("Exclusão de funcionário", f.nome, f, null);
    salvarDB();
    toast(`${f.nome} foi excluído(a).`);
    renderFuncionarios();
  });
}

$("#form-funcionario").addEventListener("submit", async (e)=>{
  e.preventDefault();
  const id = $("#ff-id").value;
  const matriculaDigitada = $("#ff-matricula").value.trim();
  const duplicada = DB.funcionarios.find(f=>f.matricula===matriculaDigitada && f.id!==id);
  if(duplicada){ toast("Já existe um funcionário com essa matrícula.", "erro"); return; }

  const dados = {
    nome: $("#ff-nome").value.trim(), matricula: matriculaDigitada, cargo: $("#ff-cargo").value.trim(),
    telefone: $("#ff-telefone").value.trim(), email: $("#ff-email").value.trim(),
    dataAdmissao: $("#ff-admissao").value, salario: parseFloat($("#ff-salario").value)||0,
    tipoContrato: $("#ff-contrato").value, status: $("#ff-status").value, observacoes: $("#ff-observacoes").value.trim(),
  };
  const novaSenha = $("#ff-senha").value;

  if(id){
    const f = getFuncionario(id);
    const antes = {...f};
    Object.assign(f, dados);
    if(novaSenha) f.senhaHash = await hashSenha(novaSenha);
    registrarAlteracao("Edição de funcionário", f.nome, antes, f);
    toast("Funcionário atualizado com sucesso.");
  } else {
    const novo = {
      id: uid("f"), ...dados, senhaHash: await hashSenha(novaSenha||"1234"),
      jornadaDiaria: DB.config.jornadaPadrao||8, jornadaSemanal: (DB.config.jornadaPadrao||8)*5,
      percentualHoraExtra: 50, adicionalNoturno:false, cpf:""
    };
    DB.funcionarios.push(novo);
    DB.escalas[novo.id] = escalaVazia();
    registrarAlteracao("Cadastro de funcionário", novo.nome, null, novo);
    toast("Funcionário cadastrado com sucesso.");
  }
  salvarDB();
  fecharModal("modal-funcionario-overlay");
  renderFuncionarios();
  atualizarSelects();
});

/* ==================================================================
   10. ESCALAS
   ================================================================== */
function atualizarSelects(){
  const ativosOptions = DB.funcionarios.map(f=>`<option value="${f.id}">${f.nome} (${f.matricula})</option>`).join("");
  ["f-escala-funcionario","f-horas-funcionario","f-controle-funcionario","cal-funcionario"].forEach(id=>{
    const sel = $("#"+id); if(!sel) return;
    const atual = sel.value;
    sel.innerHTML = ativosOptions;
    if(atual) sel.value = atual;
  });
  const rSel = $("#r-funcionario");
  if(rSel) rSel.innerHTML = `<option value="">Todos os funcionários</option>` + ativosOptions;
}

function renderEscalas(){
  atualizarSelects();
  let selId = $("#f-escala-funcionario").value || (DB.funcionarios[0] && DB.funcionarios[0].id);
  if(selId) $("#f-escala-funcionario").value = selId;
  desenharGradeEscala(selId);
}
$("#f-escala-funcionario").addEventListener("change", ()=> desenharGradeEscala($("#f-escala-funcionario").value));
$("#f-escala-modelo").addEventListener("change", (e)=>{
  const modelo = e.target.value;
  if(!modelo || modelo==="personalizada") return;
  const dias = aplicarModeloEscala(escalaVazia(), modelo);
  desenharGradeEscala($("#f-escala-funcionario").value, dias);
});

function desenharGradeEscala(funcionarioId, diasOverride=null){
  if(!funcionarioId){ $("#escala-grid").innerHTML = `<p class="texto-muted">Cadastre um funcionário primeiro.</p>`; return; }
  const dias = diasOverride || getEscala(funcionarioId);
  $("#escala-grid").dataset.funcionarioId = funcionarioId;
  $("#escala-grid").innerHTML = DIAS_ORDEM.map(chave=>{
    const d = dias[chave] || {ativo:false, entrada:"", saidaIntervalo:"", retorno:"", saida:""};
    return `
    <div class="escala-linha" data-dia="${chave}">
      <strong>${DIAS_LABEL[chave]}</strong>
      <label class="escala-toggle">
        <span class="chk-switch"><input type="checkbox" class="escala-ativo" ${d.ativo?"checked":""}><span class="chk-slider"></span></span>
        <span>${d.ativo?"Trabalha":"Folga"}</span>
      </label>
      ${d.ativo ? `
        <div class="campo"><label>Entrada</label><input type="time" class="escala-entrada" value="${d.entrada||""}"></div>
        <div class="campo"><label>Saída intervalo / Retorno</label>
          <div style="display:flex; gap:6px;">
            <input type="time" class="escala-saida-intervalo" value="${d.saidaIntervalo||""}">
            <input type="time" class="escala-retorno" value="${d.retorno||""}">
          </div>
        </div>
        <div class="campo"><label>Saída</label><input type="time" class="escala-saida" value="${d.saida||""}"></div>
      ` : `<span class="escala-folga-label">Dia de folga — sem horário definido.</span>`}
    </div>`;
  }).join("");

  $all(".escala-ativo").forEach(chk=>{
    chk.addEventListener("change", ()=>{
      const linha = chk.closest(".escala-linha");
      const chave = linha.dataset.dia;
      const diasAtuais = coletarEscalaDaTela();
      diasAtuais[chave].ativo = chk.checked;
      if(chk.checked && !diasAtuais[chave].entrada){ Object.assign(diasAtuais[chave], {entrada:"08:00", saidaIntervalo:"12:00", retorno:"13:00", saida:"18:00"}); }
      desenharGradeEscala(funcionarioId, diasAtuais);
    });
  });
}

function coletarEscalaDaTela(){
  const dias = escalaVazia();
  $all(".escala-linha").forEach(linha=>{
    const chave = linha.dataset.dia;
    const ativo = $(".escala-ativo", linha)?.checked || false;
    dias[chave] = {
      ativo,
      entrada: linha.querySelector(".escala-entrada")?.value || "",
      saidaIntervalo: linha.querySelector(".escala-saida-intervalo")?.value || "",
      retorno: linha.querySelector(".escala-retorno")?.value || "",
      saida: linha.querySelector(".escala-saida")?.value || "",
    };
  });
  return dias;
}

$("#btn-salvar-escala").addEventListener("click", ()=>{
  const funcionarioId = $("#escala-grid").dataset.funcionarioId;
  if(!funcionarioId){ toast("Selecione um funcionário.", "erro"); return; }
  const antes = getEscala(funcionarioId);
  const novaEscala = coletarEscalaDaTela();
  DB.escalas[funcionarioId] = novaEscala;
  const f = getFuncionario(funcionarioId);
  registrarAlteracao("Atualização de escala", f.nome, antes, novaEscala);
  salvarDB();
  toast("Escala salva com sucesso.");
});

/* ==================================================================
   11. SALÁRIOS
   ================================================================== */
function calcularValorHora(f){
  const horasMes = (f.jornadaSemanal||40) * 4.345; // média de semanas por mês
  return horasMes > 0 ? f.salario / horasMes : 0;
}

function renderSalarios(){
  $("#tabela-salarios tbody").innerHTML = DB.funcionarios.map(f=>{
    const valorHora = calcularValorHora(f);
    const valorHoraExtra = valorHora * (1 + (f.percentualHoraExtra||50)/100);
    return `<tr>
      <td><div class="celula-nome"><div class="avatar">${iniciais(f.nome)}</div><span>${f.nome}</span></div></td>
      <td>${fmtMoney(f.salario)}</td>
      <td><input type="number" class="sal-jornada-diaria" data-id="${f.id}" value="${f.jornadaDiaria||8}" min="1" max="12" style="width:64px; padding:6px; border-radius:6px; border:1px solid var(--border)"> h</td>
      <td><input type="number" class="sal-jornada-semanal" data-id="${f.id}" value="${f.jornadaSemanal||40}" min="1" max="60" style="width:64px; padding:6px; border-radius:6px; border:1px solid var(--border)"> h</td>
      <td>${fmtMoney(valorHora)}</td>
      <td>${fmtMoney(valorHoraExtra)} <span style="color:var(--text-faint)">(+${f.percentualHoraExtra||50}%)</span></td>
      <td><label class="escala-toggle" style="gap:6px"><span class="chk-switch"><input type="checkbox" class="sal-adicional-noturno" data-id="${f.id}" ${f.adicionalNoturno?"checked":""}><span class="chk-slider"></span></span> 20%</label></td>
      <td><button class="btn-icone" data-id="${f.id}" title="Salvar" class="btn-salvar-salario"><i class="fa-solid fa-floppy-disk"></i></button></td>
    </tr>`;
  }).join("") || `<tr><td colspan="8" class="tabela-vazia">Nenhum funcionário cadastrado.</td></tr>`;

  $all("#tabela-salarios [title='Salvar']").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      const id = btn.dataset.id;
      const f = getFuncionario(id);
      const antes = {...f};
      f.jornadaDiaria = parseFloat($(`.sal-jornada-diaria[data-id="${id}"]`).value)||8;
      f.jornadaSemanal = parseFloat($(`.sal-jornada-semanal[data-id="${id}"]`).value)||40;
      f.adicionalNoturno = $(`.sal-adicional-noturno[data-id="${id}"]`).checked;
      registrarAlteracao("Atualização de dados salariais", f.nome, antes, f);
      salvarDB();
      toast(`Dados salariais de ${f.nome} atualizados.`);
      renderSalarios();
    });
  });
}

/* ==================================================================
   12. HORAS TRABALHADAS
   ================================================================== */
let modoHoras = "diario";
$all("#abas-horas .aba-btn").forEach(btn=>{
  btn.addEventListener("click", ()=>{
    modoHoras = btn.dataset.modo;
    $all("#abas-horas .aba-btn").forEach(b=>b.classList.toggle("active", b===btn));
    renderHoras();
  });
});
$("#f-horas-funcionario").addEventListener("change", renderHoras);

function renderHoras(){
  atualizarSelects();
  if(SESSAO.tipo==="funcionario"){
    $("#f-horas-funcionario").value = SESSAO.funcionarioId;
    $("#f-horas-funcionario").disabled = true;
  }
  const funcionarioId = SESSAO.tipo==="funcionario" ? SESSAO.funcionarioId : ($("#f-horas-funcionario").value || DB.funcionarios[0]?.id);
  if(!funcionarioId){ return; }
  $("#f-horas-funcionario").value = funcionarioId;

  const dataHoje = hoje();
  if(modoHoras === "diario") renderHorasDiario(funcionarioId, dataHoje);
  else if(modoHoras === "semanal") renderHorasSemanal(funcionarioId, dataHoje);
  else renderHorasMensal(funcionarioId, dataHoje);
}

function renderHorasDiario(funcionarioId, dataHoje){
  const dias = [];
  for(let i=13;i>=0;i--) dias.push(addDias(dataHoje,-i));
  let totalTrab=0, totalPrev=0, totalExtra=0;
  const linhas = dias.map(d=>{
    const s = statusDoDia(funcionarioId, d);
    totalTrab+=s.trabalhado; totalPrev+=s.previsto; totalExtra+=s.extraMin;
    const dif = s.trabalhado - s.previsto;
    return `<tr>
      <td>${fmtDataBR(d)}</td><td>${s.ponto?.entrada||"—"}</td><td>${s.ponto?.saidaIntervalo||"—"}</td>
      <td>${s.ponto?.retornoIntervalo||"—"}</td><td>${s.ponto?.saida||"—"}</td>
      <td>${fmtHorasMin(s.trabalhado)}</td><td>${fmtHorasMin(s.previsto)}</td>
      <td style="color:${dif<0?'var(--danger)':'var(--primary-dark)'}">${dif===0?"—":fmtHorasMin(dif)}</td>
      <td>${fmtHorasMin(s.extraMin)}</td><td>${badgeSituacao(s.situacao)}</td>
    </tr>`;
  }).join("");
  $("#tabela-horas thead").innerHTML = `<tr><th>Data</th><th>Entrada</th><th>Saída interv.</th><th>Retorno</th><th>Saída</th><th>Total</th><th>Previsto</th><th>Diferença</th><th>Extras</th><th>Situação</th></tr>`;
  $("#tabela-horas tbody").innerHTML = linhas;
  $("#horas-resumo").innerHTML = resumoCards([
    ["Horas trabalhadas (14 dias)", fmtHorasMin(totalTrab), "var(--primary)"],
    ["Horas previstas", fmtHorasMin(totalPrev), "var(--info)"],
    ["Horas extras", fmtHorasMin(totalExtra), "var(--amber)"],
    ["Diferença", fmtHorasMin(totalTrab-totalPrev), (totalTrab-totalPrev)<0?"var(--danger)":"var(--primary)"],
  ]);
}

function renderHorasSemanal(funcionarioId, dataHoje){
  const inicioSemana = addDias(dataHoje, -((new Date(dataHoje+"T00:00:00").getDay()+6)%7));
  let totalTrab=0, totalPrev=0, totalExtra=0, faltantes=0, diasContados=0;
  let cursor=inicioSemana;
  const linhas=[];
  while(cursor<=addDias(inicioSemana,6)){
    const s = statusDoDia(funcionarioId, cursor);
    if(s.situacao!=="Folga" && s.situacao!=="Agendado"){
      totalTrab+=s.trabalhado; totalPrev+=s.previsto; totalExtra+=s.extraMin; diasContados++;
      if(s.trabalhado<s.previsto) faltantes += (s.previsto-s.trabalhado);
    }
    linhas.push(`<tr><td>${DIAS_LABEL[diaSemanaChave(cursor)]} — ${fmtDataBR(cursor)}</td><td>${fmtHorasMin(s.trabalhado)}</td><td>${fmtHorasMin(s.previsto)}</td><td>${fmtHorasMin(s.extraMin)}</td><td>${badgeSituacao(s.situacao)}</td></tr>`);
    cursor = addDias(cursor,1);
  }
  $("#tabela-horas thead").innerHTML = `<tr><th>Dia</th><th>Horas trabalhadas</th><th>Horas previstas</th><th>Horas extras</th><th>Situação</th></tr>`;
  $("#tabela-horas tbody").innerHTML = linhas.join("");
  $("#horas-resumo").innerHTML = resumoCards([
    ["Total trabalhado (semana)", fmtHorasMin(totalTrab), "var(--primary)"],
    ["Total previsto", fmtHorasMin(totalPrev), "var(--info)"],
    ["Horas extras", fmtHorasMin(totalExtra), "var(--amber)"],
    ["Média/dia", diasContados? fmtHorasMin(totalTrab/diasContados) : "—h", "var(--primary)"],
  ]);
}

function renderHorasMensal(funcionarioId, dataHoje){
  const inicioMes = dataHoje.slice(0,8)+"01";
  let totalTrab=0, totalPrev=0, totalExtra=0, faltas=0, atrasos=0, diasTrab=0;
  let cursor=inicioMes; const linhas=[];
  while(cursor<=dataHoje){
    const s = statusDoDia(funcionarioId, cursor);
    if(s.situacao!=="Folga" && s.situacao!=="Agendado" && s.situacao!=="Feriado"){
      totalTrab+=s.trabalhado; totalPrev+=s.previsto; totalExtra+=s.extraMin;
      if(s.situacao==="Falta") faltas++; else diasTrab++;
      if(s.situacao==="Atraso") atrasos++;
    }
    linhas.push(`<tr><td>${fmtDataBR(cursor)}</td><td>${fmtHorasMin(s.trabalhado)}</td><td>${fmtHorasMin(s.previsto)}</td><td>${fmtHorasMin(s.extraMin)}</td><td>${badgeSituacao(s.situacao)}</td></tr>`);
    cursor = addDias(cursor,1);
  }
  $("#tabela-horas thead").innerHTML = `<tr><th>Dia</th><th>Horas trabalhadas</th><th>Horas previstas</th><th>Horas extras</th><th>Situação</th></tr>`;
  $("#tabela-horas tbody").innerHTML = linhas.reverse().join("");
  $("#horas-resumo").innerHTML = resumoCards([
    ["Horas trabalhadas (mês)", fmtHorasMin(totalTrab), "var(--primary)"],
    ["Horas extras (mês)", fmtHorasMin(totalExtra), "var(--amber)"],
    ["Faltas / Atrasos", `${faltas} / ${atrasos}`, "var(--danger)"],
    ["Dias trabalhados", diasTrab, "var(--primary)"],
  ]);
}

function resumoCards(itens){
  return itens.map(([label,valor,cor])=>`
    <div class="card-metric" style="--card-cor:${cor}">
      <strong>${valor}</strong><span>${label}</span>
    </div>`).join("");
}

/* ==================================================================
   13. CONTROLE DE PONTO (ADMIN)
   ================================================================== */
function renderControle(){
  atualizarSelects();
  const funcionarioId = $("#f-controle-funcionario").value;
  const dataFiltro = $("#f-controle-data").value;
  const statusFiltro = $("#f-controle-status").value;

  const alvo = funcionarioId ? [getFuncionario(funcionarioId)] : DB.funcionarios;
  const linhas = [];
  const dataHoje = hoje();

  alvo.forEach(f=>{
    if(!f) return;
    const datas = dataFiltro ? [dataFiltro] : Array.from({length:15}, (_,i)=>addDias(dataHoje,-i));
    datas.forEach(d=>{
      const s = statusDoDia(f.id, d);
      if(s.situacao==="Folga" || s.situacao==="Agendado") return;
      if(statusFiltro && s.situacao!==statusFiltro) return;
      linhas.push({f, data:d, s});
    });
  });
  linhas.sort((a,b)=> b.data.localeCompare(a.data));

  $("#tabela-controle tbody").innerHTML = linhas.length ? linhas.map(({f,data,s})=>`
    <tr>
      <td><div class="celula-nome"><div class="avatar">${iniciais(f.nome)}</div><span>${f.nome}</span></div></td>
      <td>${fmtDataBR(data)}</td>
      <td>${s.ponto?.entrada||"—"}</td><td>${s.ponto?.saidaIntervalo||"—"}</td>
      <td>${s.ponto?.retornoIntervalo||"—"}</td><td>${s.ponto?.saida||"—"}</td>
      <td>${badgeSituacao(s.situacao)}</td>
      <td><button class="btn-icone" data-id="${f.id}" data-data="${data}" title="Corrigir"><i class="fa-solid fa-pen"></i></button></td>
    </tr>`).join("") : `<tr><td colspan="8" class="tabela-vazia">Nenhum registro encontrado para o filtro selecionado.</td></tr>`;

  $all("#tabela-controle [title='Corrigir']").forEach(btn=>{
    btn.addEventListener("click", ()=> abrirCorrecaoPonto(btn.dataset.id, btn.dataset.data));
  });
}
["f-controle-funcionario","f-controle-data","f-controle-status"].forEach(id=>{
  $("#"+id).addEventListener("change", renderControle);
});

function abrirCorrecaoPonto(funcionarioId, data){
  const ponto = pontoDoDia(funcionarioId, data) || {};
  $("#fc-ponto-id").value = `${funcionarioId}|${data}`;
  $("#fc-entrada").value = ponto.entrada||"";
  $("#fc-saida-intervalo").value = ponto.saidaIntervalo||"";
  $("#fc-retorno").value = ponto.retornoIntervalo||"";
  $("#fc-saida").value = ponto.saida||"";
  $("#fc-motivo").value = "";
  abrirModal("modal-corrigir-overlay");
}

$("#form-corrigir").addEventListener("submit", (e)=>{
  e.preventDefault();
  const [funcionarioId, data] = $("#fc-ponto-id").value.split("|");
  let ponto = pontoDoDia(funcionarioId, data);
  const antes = ponto ? {...ponto} : null;
  if(!ponto){
    ponto = {id:uid("p"), funcionarioId, data, entrada:null, saidaIntervalo:null, retornoIntervalo:null, saida:null, observacao:""};
    DB.pontos.push(ponto);
  }
  ponto.entrada = $("#fc-entrada").value || null;
  ponto.saidaIntervalo = $("#fc-saida-intervalo").value || null;
  ponto.retornoIntervalo = $("#fc-retorno").value || null;
  ponto.saida = $("#fc-saida").value || null;
  ponto.observacao = $("#fc-motivo").value.trim();

  const f = getFuncionario(funcionarioId);
  registrarAlteracao("Correção de ponto", `${f.nome} — ${fmtDataBR(data)}`, antes, ponto);
  salvarDB();
  fecharModal("modal-corrigir-overlay");
  toast("Registro de ponto corrigido.");
  renderControle();
});

/* ==================================================================
   14. RELATÓRIOS
   ================================================================== */
$("#r-periodo").addEventListener("change", ()=>{
  const p = $("#r-periodo").value;
  $("#r-data-fim").classList.toggle("oculto", p!=="personalizado");
  $("#r-data-inicio").classList.toggle("oculto", false);
});
$("#r-data-inicio").value = hoje().slice(0,8)+"01";
$("#r-data-fim").value = hoje();

function renderRelatorios(){ atualizarSelects(); }

let ultimoRelatorio = [];

$("#btn-gerar-relatorio").addEventListener("click", ()=>{
  const funcionarioId = $("#r-funcionario").value;
  const periodo = $("#r-periodo").value;
  const dataHoje = hoje();
  let inicio, fim;
  if(periodo==="dia"){ inicio = fim = $("#r-data-inicio").value || dataHoje; }
  else if(periodo==="semana"){ fim = dataHoje; inicio = addDias(dataHoje,-6); }
  else if(periodo==="mes"){ fim = dataHoje; inicio = dataHoje.slice(0,8)+"01"; }
  else { inicio = $("#r-data-inicio").value; fim = $("#r-data-fim").value || dataHoje; }

  const alvo = funcionarioId ? [getFuncionario(funcionarioId)] : DB.funcionarios;
  ultimoRelatorio = alvo.map(f=>{
    let horasTrab=0, horasPrev=0, extras=0, atrasos=0, faltas=0, saidasAntecip=0, diasTrab=0;
    let cursor = inicio;
    while(cursor<=fim){
      const s = statusDoDia(f.id, cursor);
      if(s.situacao!=="Folga" && s.situacao!=="Agendado" && s.situacao!=="Feriado"){
        horasTrab+=s.trabalhado; horasPrev+=s.previsto; extras+=s.extraMin;
        if(s.situacao==="Falta") faltas++; else diasTrab++;
        if(s.situacao==="Atraso") atrasos++;
        if(s.saidaAntecipMin>0) saidasAntecip++;
      }
      cursor = addDias(cursor,1);
    }
    return {f, horasTrab, horasPrev, extras, atrasos, faltas, saidasAntecip, diasTrab, inicio, fim};
  });

  $("#relatorio-cabecalho-print").innerHTML = `
    <h2 style="font-family:'Sora',sans-serif; margin-bottom:4px;">Relatório de Ponto — PontoCerto Supermercados</h2>
    <p style="color:#5C6E64; font-size:0.85rem;">Período: ${fmtDataBR(inicio)} a ${fmtDataBR(fim)} · Gerado em ${new Date().toLocaleString("pt-BR")}</p>`;

  $("#tabela-relatorio tbody").innerHTML = ultimoRelatorio.length ? ultimoRelatorio.map(r=>`
    <tr>
      <td>${r.f.nome}</td><td>${r.f.matricula}</td><td>${r.f.cargo}</td><td>${r.diasTrab}</td>
      <td>${fmtHorasMin(r.horasTrab)}</td><td>${fmtHorasMin(r.horasPrev)}</td><td>${fmtHorasMin(r.extras)}</td>
      <td>${r.atrasos}</td><td>${r.faltas}</td><td>${r.saidasAntecip}</td>
    </tr>`).join("") : `<tr><td colspan="10" class="tabela-vazia">Nenhum dado para o período selecionado.</td></tr>`;

  toast("Relatório gerado.");
});

$("#btn-imprimir").addEventListener("click", ()=> window.print());
$("#btn-exportar-pdf").addEventListener("click", ()=>{
  toast("Use a opção \"Salvar como PDF\" na janela de impressão do navegador.");
  window.print();
});
$("#btn-exportar-csv").addEventListener("click", ()=>{
  if(!ultimoRelatorio.length){ toast("Gere um relatório primeiro.", "erro"); return; }
  const cabecalho = ["Funcionário","Matrícula","Cargo","Dias trabalhados","Horas trabalhadas","Horas previstas","Horas extras","Atrasos","Faltas","Saídas antecipadas"];
  const linhas = ultimoRelatorio.map(r=>[r.f.nome, r.f.matricula, r.f.cargo, r.diasTrab, fmtHorasMin(r.horasTrab), fmtHorasMin(r.horasPrev), fmtHorasMin(r.extras), r.atrasos, r.faltas, r.saidasAntecip]);
  const csv = [cabecalho, ...linhas].map(l => l.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(";")).join("\n");
  const blob = new Blob(["\uFEFF"+csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `relatorio-ponto-${hoje()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Arquivo CSV exportado — abre direto no Excel.");
});

/* ==================================================================
   15. CALENDÁRIO
   ================================================================== */
let calMesRef = new Date();
function renderCalendario(){
  atualizarSelects();
  if(SESSAO.tipo==="funcionario"){ $("#cal-funcionario").value = SESSAO.funcionarioId; $("#cal-funcionario").disabled = true; }
  if(!$("#cal-funcionario").value && DB.funcionarios[0]) $("#cal-funcionario").value = DB.funcionarios[0].id;
  desenharCalendario();
}
$("#cal-funcionario").addEventListener("change", desenharCalendario);
$("#cal-anterior").addEventListener("click", ()=>{ calMesRef.setMonth(calMesRef.getMonth()-1); desenharCalendario(); });
$("#cal-proximo").addEventListener("click", ()=>{ calMesRef.setMonth(calMesRef.getMonth()+1); desenharCalendario(); });

function desenharCalendario(){
  const funcionarioId = $("#cal-funcionario").value;
  if(!funcionarioId){ $("#calendario-grid").innerHTML=""; return; }
  $("#cal-mes-ano").textContent = calMesRef.toLocaleDateString("pt-BR",{month:"long", year:"numeric"});

  const ano = calMesRef.getFullYear(), mes = calMesRef.getMonth();
  const primeiroDia = new Date(ano,mes,1);
  const offset = (primeiroDia.getDay()+6)%7; // segunda como primeiro dia da semana
  const diasNoMes = new Date(ano,mes+1,0).getDate();

  const cabecalhos = ["SEG","TER","QUA","QUI","SEX","SÁB","DOM"].map(d=>`<div class="cal-cab">${d}</div>`).join("");
  let celulas = "";
  for(let i=0;i<offset;i++) celulas += `<div class="cal-dia vazio"></div>`;
  for(let dia=1; dia<=diasNoMes; dia++){
    const iso = isoDate(new Date(ano,mes,dia));
    const s = statusDoDia(funcionarioId, iso);
    const classeCor = { "Trabalhou":"cor-trabalhou","Atraso":"cor-trabalhou","Saída antecipada":"cor-trabalhou","Falta":"cor-falta","Folga":"cor-folga","Feriado":"cor-feriado","Agendado":"cor-folga" }[s.situacao] || "cor-folga";
    celulas += `<div class="cal-dia" data-data="${iso}">
      <span class="cal-dia-num">${dia}</span>
      <span class="cal-dia-status ${classeCor}">${s.situacao}</span>
    </div>`;
  }
  $("#calendario-grid").innerHTML = cabecalhos + celulas;

  $all(".cal-dia[data-data]").forEach(el=>{
    el.addEventListener("click", ()=> abrirDetalheDia(funcionarioId, el.dataset.data));
  });
}

function abrirDetalheDia(funcionarioId, dataISO){
  const f = getFuncionario(funcionarioId);
  const s = statusDoDia(funcionarioId, dataISO);
  $("#modal-dia-titulo").textContent = `${fmtDataBR(dataISO)} — ${f.nome}`;
  $("#modal-dia-corpo").innerHTML = `
    <div style="margin-bottom:14px;">${badgeSituacao(s.situacao)}</div>
    <div class="perfil-grid">
      <div><b>Entrada</b>${s.ponto?.entrada||"—"}</div>
      <div><b>Saída intervalo</b>${s.ponto?.saidaIntervalo||"—"}</div>
      <div><b>Retorno</b>${s.ponto?.retornoIntervalo||"—"}</div>
      <div><b>Saída</b>${s.ponto?.saida||"—"}</div>
      <div><b>Horas trabalhadas</b>${fmtHorasMin(s.trabalhado)}</div>
      <div><b>Horas previstas</b>${fmtHorasMin(s.previsto)}</div>
    </div>`;
  abrirModal("modal-dia-overlay");
}

/* ==================================================================
   16. HISTÓRICO
   ================================================================== */
function renderHistorico(){
  $("#tabela-historico tbody").innerHTML = DB.alteracoes.length ? DB.alteracoes.slice(0,200).map(h=>`
    <tr>
      <td>${new Date(h.dataHora).toLocaleString("pt-BR")}</td>
      <td>${h.usuario}</td><td>${h.acao}</td><td>${h.registro}</td>
      <td style="max-width:220px; white-space:normal; font-family:var(--font-mono); font-size:0.72rem; color:var(--text-faint)">${h.antes}</td>
      <td style="max-width:220px; white-space:normal; font-family:var(--font-mono); font-size:0.72rem;">${h.depois}</td>
    </tr>`).join("") : `<tr><td colspan="6" class="tabela-vazia">Nenhuma alteração registrada ainda.</td></tr>`;
}

/* ==================================================================
   17. CONFIGURAÇÕES
   ================================================================== */
function renderConfiguracoes(){
  $("#cfg-tolerancia").value = DB.config.tolerancia;
  $("#cfg-jornada").value = DB.config.jornadaPadrao;
}
$("#cfg-tolerancia").addEventListener("change", ()=>{ DB.config.tolerancia = parseInt($("#cfg-tolerancia").value)||0; salvarDB(); toast("Tolerância de atraso atualizada."); });
$("#cfg-jornada").addEventListener("change", ()=>{ DB.config.jornadaPadrao = parseInt($("#cfg-jornada").value)||8; salvarDB(); toast("Jornada padrão atualizada."); });
$("#btn-limpar-dados").addEventListener("click", ()=>{
  confirmar("Limpar todos os dados", "Isso apagará todos os funcionários, pontos e histórico de demonstração, recriando os dados iniciais. Deseja continuar?", async ()=>{
    localStorage.removeItem(DB_KEY);
    await seedInicial();
    toast("Dados de demonstração restaurados.");
    location.reload();
  });
});

/* ==================================================================
   18. INICIALIZAÇÃO
   ================================================================== */
(async function iniciar(){
  carregarDB();
  if(!DB){ await seedInicial(); }
  carregarSessao();
  if(SESSAO){
    const aindaValido = SESSAO.tipo==="admin" || getFuncionario(SESSAO.funcionarioId);
    if(aindaValido){ entrarNoApp(); return; }
    limparSessao();
  }
})();

})();