import React, { useState, useEffect } from 'react';
import {
  Wallet, ArrowUpCircle, ArrowDownCircle, Loader2, Upload,
  Trash2, Send, X, RefreshCw, Filter, PieChart as PieIcon,
  Tag, Plus, CreditCard, Calendar, BarChart2, CheckCircle, AlertCircle,
  Settings, MessageSquare, Shield, Smartphone, Bot
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, AreaChart, Area
} from 'recharts';
import axios from 'axios';
import { supabase } from './supabaseClient';
import Auth from './Auth';

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3002').replace(/\/$/, '');
console.log('🌐 [DEBUG] API_URL configurada:', API_URL);

const DEFAULT_CATEGORIES = [
  "Investimentos", "Alimentação", "Transporte", "Saúde", "Lazer",
  "Educação", "Moradia", "Seguros", "Outros"
];

const PAY_METHODS = ["Crédito", "Débito", "Pix", "Boleto", "Dinheiro"];
const TRANSACTION_TYPES = ["Saída", "Entrada"];

const pad = (n) => String(n).padStart(2, '0');
const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;

const App = () => {
  const [isUploading, setIsUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [pendingTransactions, setPendingTransactions] = useState([]);
  const [allTransactions, setAllTransactions] = useState([]);
  const [editingTransaction, setEditingTransaction] = useState(null);
  const [stats, setStats] = useState({
    total: "0,00",          // Agora é o Global
    totalPeriodo: "0,00",   // Agora é o do Filtro
    entradas: "0,00",
    saidas: "0,00",
    investido: "0,00",
    chartData: [],
    categoryList: []
  });

  const initNow = new Date();
  const [dateFilters, setDateFilters] = useState({
    startDate: `${initNow.getFullYear()}-${pad(initNow.getMonth()+1)}-01`,
    endDate: fmt(initNow)
  });
  const [activeFilter, setActiveFilter] = useState('mes'); // 'hoje' | 'mes' | 'ano' | 'personalizado'
  const [searchQuery, setSearchQuery] = useState('');

  const setQuickFilter = (filter) => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    let startDate = '';
    let endDate = '';
    if (filter === 'hoje') {
      startDate = fmt(now);
      endDate   = fmt(now);
    } else if (filter === 'mes') {
      startDate = `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`;
      endDate   = fmt(now);
    } else if (filter === 'ano') {
      startDate = `${now.getFullYear()}-01-01`;
      endDate   = fmt(now);
    } else {
      // personalizado: mantém datas atuais ou reseta
      setActiveFilter('personalizado');
      return;
    }
    setActiveFilter(filter);
    setDateFilters({ startDate, endDate });
  };

  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [modalView, setModalView] = useState('select'); // 'select', 'manual'
  const [activeTab, setActiveTab] = useState('dashboard');
  const [authorizedNumber, setAuthorizedNumber] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [geminiSystemPrompt, setGeminiSystemPrompt] = useState('');
  const [processOutgoingMessages, setProcessOutgoingMessages] = useState(false);
  const [aiLogs, setAiLogs] = useState('Carregando logs...');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [waStatus, setWaStatus] = useState('disconnected');
  const [waQr, setWaQr] = useState(null);
  
  // Fornecedores State
  const [suppliers, setSuppliers] = useState([]);
  const [editingSupplier, setEditingSupplier] = useState(null);
  const [newSupplier, setNewSupplier] = useState({ nome: '', categoria: 'Outros' });
  const [searchTerm, setSearchTerm] = useState('');

  // Perfis de Banco State
  const [bankProfiles, setBankProfiles] = useState([]);
  const [editingBankProfile, setEditingBankProfile] = useState(null);
  const [newBankProfile, setNewBankProfile] = useState({ nome: '', identificador: '', palavras_ignorar: '', cartao_final: '' });

  // Auth State
  const [session, setSession] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const [manualFormData, setManualFormData] = useState({
    'Data': new Date().toISOString().split('T')[0].split('-').reverse().join('/'),
    'Mês': new Date().toLocaleString('pt-BR', { month: 'long' }),
    'Descrição': '',
    'Tipo': 'Saída',
    'Tipo de Pagamento': 'Pix',
    'Parcela': '1/1',
    'Banco/Cartão': '',
    'Categoria': 'Outros',
    'Valor (R$)': ''
  });

  // Notificações
  const [notificationHistory, setNotificationHistory] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isNotificationPanelOpen, setIsNotificationPanelOpen] = useState(false);

  const showToast = (message, type = 'success') => {
    setToast({ show: true, message, type });
    
    // Adiciona ao histórico
    const newNotif = {
      id: Date.now(),
      message,
      type,
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      read: false
    };
    setNotificationHistory(prev => [newNotif, ...prev].slice(0, 20));
    setUnreadCount(prev => prev + 1);

    // Notificação nativa se a aba estiver oculta
    if (document.hidden && Notification.permission === 'granted') {
      new Notification("Finanças Pessoais", {
        body: message,
        icon: '/favicon.ico'
      });
    }

    setTimeout(() => setToast({ show: false, message: '', type: 'success' }), 4000);
  };

  const fetchWaStatus = async () => {
    try {
      console.log('📡 [DEBUG] Buscando status do WhatsApp em:', `${API_URL}/whatsapp-status`);
      const response = await axios.get(`${API_URL}/whatsapp-status`);
      console.log('📊 [DEBUG] Status recebido:', response.data.status);
      setWaStatus(response.data.status);
      
      if (response.data.status === 'qr_ready') {
        console.log('🖼️ [DEBUG] Solicitando QR Code...');
        const qrResponse = await axios.get(`${API_URL}/whatsapp-qr`);
        setWaQr(qrResponse.data.qr);
      } else {
        setWaQr(null);
      }
    } catch (err) {
      console.error('❌ [ERROR] Falha ao capturar status WA:', err.message);
      if (err.response) {
        console.error('Dados do erro:', err.response.data);
        console.error('Status do erro:', err.response.status);
      }
    }
  };

  useEffect(() => {
    let interval;
    if (activeTab === 'settings') {
      fetchWaStatus();
      interval = setInterval(fetchWaStatus, 5000);
    }
    return () => clearInterval(interval);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === 'ai') {
      fetchSettings();
      fetchAiLogs();
      const interval = setInterval(fetchAiLogs, 3000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  const handleManualFormSubmit = async (e) => {
    e.preventDefault();
    if (!manualFormData.Descrição || !manualFormData['Valor (R$)']) {
      showToast("Preencha descrição e valor!", "error");
      return;
    }

    setLoading(true);
    try {
      // Formata valor caso o usuário não tenha colocado vírgula
      let valor = manualFormData['Valor (R$)'].replace('R$', '').trim();
      if (!valor.includes(',')) valor += ',00';

      const newEntry = { ...manualFormData, 'Valor (R$)': valor };
      
      await axios.post(`${API_URL}/save-transactions`, {
        transactions: [newEntry]
      });

      showToast("Lançamento salvo com sucesso!");
      setIsUploading(false);
      setModalView('select');
      
      // Reset form
      setManualFormData({
        'Data': new Date().toISOString().split('T')[0].split('-').reverse().join('/'),
        'Mês': new Date().toLocaleString('pt-BR', { month: 'long' }),
        'Descrição': '',
        'Tipo': 'Saída',
        'Tipo de Pagamento': 'Pix',
        'Parcela': '1/1',
        'Banco/Cartão': '',
        'Categoria': 'Outros',
        'Valor (R$)': ''
      });

      // Atualiza os dados na tela
      fetchStats();
      fetchAllTransactions();
    } catch (error) {
      console.error(error);
      const msg = error.response?.data?.details || error.message;
      showToast(`Erro ao salvar: ${msg}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async () => {
    setLoading(true);
    try {
      const { startDate, endDate } = dateFilters;
      const resp = await axios.get(`${API_URL}/dashboard-stats`, {
        params: { startDate, endDate }
      });
      setStats(resp.data);
      // Garantir que a tabela também seja atualizada
      fetchAllTransactions();
    } catch (error) {
      console.error("Erro ao carregar stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchAllTransactions = async () => {
    try {
      const resp = await axios.get(`${API_URL}/transactions`);
      setAllTransactions(resp.data);
      return resp.data;
    } catch (error) {
      console.error("Erro ao carregar transações:", error);
      return null;
    }
  };

  const fetchSuppliers = async () => {
    try {
      const resp = await axios.get(`${API_URL}/suppliers`);
      setSuppliers(resp.data);
    } catch (error) {
      console.error("Erro ao carregar fornecedores:", error);
    }
  };

  const fetchBankProfiles = async () => {
    try {
      const resp = await axios.get(`${API_URL}/bank-profiles`);
      setBankProfiles(resp.data);
    } catch (error) {
      console.error("Erro ao carregar perfis de banco:", error);
    }
  };

  const fetchSettings = async () => {
    try {
      const resp = await axios.get(`${API_URL}/settings`);
      const authNum = resp.data.find(s => s.key === 'whatsapp_authorized_number')?.value;
      const gemKey = resp.data.find(s => s.key === 'gemini_api_key')?.value;
      const sysPrompt = resp.data.find(s => s.key === 'gemini_system_prompt')?.value;
      const processOut = resp.data.find(s => s.key === 'process_outgoing_messages')?.value;
      if (authNum) setAuthorizedNumber(authNum);
      if (gemKey) setGeminiApiKey(gemKey);
      if (sysPrompt) setGeminiSystemPrompt(sysPrompt);
      if (processOut) setProcessOutgoingMessages(processOut === 'true');
    } catch (err) {
      console.error('Erro ao buscar configurações:', err);
    }
  };

  const fetchAiLogs = async () => {
    try {
      const res = await axios.get(`${API_URL}/ai-logs`);
      setAiLogs(res.data.logs);
    } catch (err) {
      console.error('Erro ao buscar logs da IA', err);
    }
  };

  const clearAiLogs = async () => {
    if (!window.confirm("Limpar logs?")) return;
    try {
      await axios.delete(`${API_URL}/ai-logs`);
      setAiLogs('Logs limpos.');
    } catch (err) {
      console.error('Erro ao limpar logs', err);
    }
  };

  const saveGeminiSystemPrompt = async () => {
    try {
      console.log('📡 [DEBUG] Salvando Prompt em:', `${API_URL}/settings`);
      await axios.post(`${API_URL}/settings`, { key: 'gemini_system_prompt', value: geminiSystemPrompt });
      showToast('Prompt do sistema atualizado!', 'success');
    } catch (err) {
      console.error('❌ Erro Prompt:', err);
      const details = err.response?.data?.details || err.message;
      showToast(`Erro ao salvar prompt: ${details}`, 'error');
    }
  };

  const saveAuthorizedNumber = async () => {
    try {
      console.log('📡 [DEBUG] Salvando Número Autorizado em:', `${API_URL}/settings`);
      await axios.post(`${API_URL}/settings`, { key: 'whatsapp_authorized_number', value: authorizedNumber });
      showToast('Segurança do WhatsApp atualizada!', 'success');
    } catch (err) {
      console.error('❌ Erro AuthorizedNumber:', err);
      const details = err.response?.data?.details || err.message;
      showToast(`Erro ao salvar configuração: ${details}`, 'error');
    }
  };

  const handleToggleOutgoing = async (e) => {
    const newValue = e.target.checked;
    setProcessOutgoingMessages(newValue);
    try {
      console.log('📡 [DEBUG] Toggling Outgoing em:', `${API_URL}/settings`);
      await axios.post(`${API_URL}/settings`, { key: 'process_outgoing_messages', value: newValue.toString() });
      showToast(newValue ? 'Processamento a terceiros ativado!' : 'Processamento a terceiros desativado!');
    } catch (err) {
      console.error('❌ Erro ToggleOutgoing:', err);
      const details = err.response?.data?.details || err.message;
      showToast(`Erro ao atualizar configuração: ${details}`, 'error');
      setProcessOutgoingMessages(!newValue); // rollback on error
    }
  };

  const saveGeminiApiKey = async () => {
    try {
      console.log('📡 Enviando configuração para:', `${API_URL}/settings`);
      await axios.post(`${API_URL}/settings`, { key: 'gemini_api_key', value: geminiApiKey });
      showToast('🤖 Gemini IA ativada com sucesso!', 'success');
    } catch (err) {
      console.error('❌ Erro de Rede Detalhado:', err);
      const details = err.response?.data?.details || err.message;
      showToast(`Erro ao salvar: ${details}`, 'error');
    }
  };

  const handleLogoutWhatsApp = async () => {
    if (!window.confirm("Certeza que deseja desconectar o WhatsApp?")) return;
    try {
      await axios.post(`${API_URL}/whatsapp-logout`);
      showToast('WhatsApp desconectado!');
      setWaStatus('disconnected');
      setWaQr(null);
    } catch (err) {
      const details = err.response?.data?.details || err.message;
      showToast(`Erro ao desconectar: ${details}`, 'error');
    }
  };

  useEffect(() => {
    // Solicitar permissão de notificações
    if ("Notification" in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Fechar painel ao clicar fora
    const handleClickOutside = (e) => {
      if (isNotificationPanelOpen && !e.target.closest('.notifications-dropdown') && !e.target.closest('#notification-bell')) {
        setIsNotificationPanelOpen(false);
      }
    };
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [isNotificationPanelOpen]);

  useEffect(() => {
    if (dateFilters.startDate !== '' || dateFilters.endDate !== '' || activeFilter !== 'personalizado') {
      fetchStats();
    }
  }, [dateFilters.startDate, dateFilters.endDate]);

  const prevCountRef = React.useRef(0);

  useEffect(() => {
    fetchStats();
    fetchAllTransactions().then(data => {
      if (data) prevCountRef.current = data.length;
    });
    fetchSuppliers();
    fetchSettings();
    fetchBankProfiles();
    fetchWaStatus();
    
    // Polling global para capturar lançamentos externos (WhatsApp/IA)
    const interval = setInterval(async () => {
      if (!loading && activeTab !== 'ai') {
        fetchStats();
        const latestTransactions = await fetchAllTransactions();
        if (latestTransactions && latestTransactions.length > prevCountRef.current) {
          const diff = latestTransactions.length - prevCountRef.current;
          showToast(`🤖 ${diff} novo(s) lançamento(s) detectado(s)!`, 'info');
          prevCountRef.current = latestTransactions.length;
        }
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [activeTab]);

  // Busca: filtra transações pelo searchQuery
  const filteredTransactions = searchQuery
    ? allTransactions.filter(t => {
        const query = searchQuery.toLowerCase();
        return [
          t['Descrição'],
          t['Categoria'],
          t['Banco/Cartão'],
          t['Tipo'],
          t['Data'],
          t['Mês'],
          t['Tipo de Pagamento']
        ].some(val => val && String(val).toLowerCase().includes(query));
      })
    : allTransactions;

  const handleFileUpload = async (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('images', files[i]);
    }

    setLoading(true);
    setStatus(`Processando ${files.length} imagem(ns)...`);

    try {
      const resp = await axios.post(`${API_URL}/process-image`, formData);
      setPendingTransactions(resp.data.data);
      showToast(`Encontradas ${resp.data.data.length} transações.`);
      setIsUploading(false);
      setStatus('');
    } catch (error) {
      console.error(error);
      const msg = error.response?.data?.details || error.message;
      showToast(`Erro OCR: ${msg} `, 'error');
      setStatus('');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToDb = async () => {
    if (pendingTransactions.length === 0) return;

    setLoading(true);
    setStatus('Salvando no banco de dados...');

    try {
      await axios.post(`${API_URL}/save-transactions`, {
        transactions: pendingTransactions
      });
      showToast('Banco de dados atualizado com sucesso!');
      setPendingTransactions([]);
      fetchStats();
      fetchAllTransactions();
      setStatus('');
    } catch (error) {
      console.error(error);
      const msg = error.response?.data?.details || error.message;
      showToast(`Erro ao salvar no banco: ${msg}`, 'error');
      setStatus('');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteTransaction = async (id) => {
    if (!window.confirm("Certeza que deseja excluir este lançamento?")) return;
    try {
      await axios.delete(`${API_URL}/transactions/${id}`);
      showToast('Transação excluída com sucesso!');
      fetchStats();
      fetchAllTransactions();
    } catch (error) {
      console.error(error);
      showToast('Erro ao excluir transação', 'error');
    }
  };

  const handleEditTransaction = (transaction) => {
    setEditingTransaction({ ...transaction });
  };

  const handleSaveEdit = async () => {
    if (!editingTransaction) return;
    setLoading(true);
    try {
      await axios.put(`${API_URL}/transactions/${editingTransaction.id}`, editingTransaction);
      showToast('Transação atualizada com sucesso!');
      setEditingTransaction(null);
      fetchStats();
      fetchAllTransactions();
    } catch (error) {
      console.error(error);
      showToast('Erro ao atualizar transação', 'error');
    } finally {
      setLoading(false);
    }
  };

  // --- CRUD Fornecedores ---
  const handleSaveSupplier = async () => {
      if (!newSupplier.nome) return showToast("Digite o nome do fornecedor!", "error");
      setLoading(true);
      try {
          if (editingSupplier) {
              await axios.put(`${API_URL}/suppliers/${editingSupplier.id}`, newSupplier);
              showToast("Fornecedor atualizado!");
          } else {
              await axios.post(`${API_URL}/suppliers`, newSupplier);
              showToast("Fornecedor cadastrado!");
          }
          setNewSupplier({ nome: '', categoria: 'Outros' });
          setEditingSupplier(null);
          fetchSuppliers();
      } catch (error) {
          showToast("Erro ao salvar fornecedor", "error");
      } finally {
          setLoading(false);
      }
  };

  const handleDeleteSupplier = async (id) => {
      if (!window.confirm("Excluir este fornecedor?")) return;
      try {
          await axios.delete(`${API_URL}/suppliers/${id}`);
          showToast("Fornecedor excluído!");
          fetchSuppliers();
      } catch (error) {
          showToast("Erro ao excluir fornecedor", "error");
      }
  };

  const handleEditSupplierClick = (supplier) => {
      setEditingSupplier(supplier);
      setNewSupplier({ nome: supplier.nome, categoria: supplier.categoria });
  };

  const updateTransaction = (index, field, value) => {
    const updated = [...pendingTransactions];
    updated[index][field] = value;
    setPendingTransactions(updated);
  };

  const removeTransaction = (index) => {
    setPendingTransactions(pendingTransactions.filter((_, i) => i !== index));
  };

  const handleAddManualRow = () => {
    const newEntry = {
      'Data': new Date().toLocaleDateString('pt-BR'),
      'Mês': new Date().toLocaleString('pt-BR', { month: 'long' }),
      'Descrição': '',
      'Tipo': 'Saída',
      'Tipo de Pagamento': 'Pix',
      'Parcela': '1/1',
      'Banco/Cartão': '',
      'Categoria': 'Outros',
      'Valor (R$)': '0,00'
    };
    setPendingTransactions([newEntry, ...pendingTransactions]);
    setIsUploading(false); // Close upload modal if it's open
  };

  const applyGlobalCategory = (cat) => {
    if (!cat) return;
    setPendingTransactions(pendingTransactions.map(t => ({ ...t, 'Categoria': cat })));
  };

  const handleAddCategory = () => {
    const newCat = prompt("Digite o nome da nova categoria:");
      if (newCat && !categories.includes(newCat)) {
      setCategories([...categories, newCat]);
    }
  };



  if (!session) {
    return <Auth />;
  }

  return (
    <div className="app-container" style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* Toast Notification */}
      {toast.show && (
        <div className={`toast ${toast.type}`}>
          <span className="material-symbols-outlined" style={{ fontSize: '1.25rem' }}>
            {toast.type === 'success' ? 'check_circle' : 'error'}
          </span>
          <span>{toast.message}</span>
        </div>
      )}

      {/* Sidebar */}
      <aside className="sidebar-modern">
        <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '2.5rem', padding: '0 0.5rem' }}>
          <div style={{ width: 32, height: 32, background: 'var(--primary)', borderRadius: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Wallet color="white" size={18} />
          </div>
          <div>
            <span style={{ fontWeight: '800', fontSize: '1.1rem', background: 'linear-gradient(90deg, #1e293b, #475569)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Finanças Pro</span>
            <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Gestão Inteligente</div>
          </div>
        </div>

        <nav className="nav-menu" style={{ flex: 1 }}>
          <button 
            className={`nav-link ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <span className="material-symbols-outlined">dashboard</span>
            <span>Dashboard</span>
          </button>
          
          <button 
            className={`nav-link ${activeTab === 'transactions' ? 'active' : ''}`}
            onClick={() => setActiveTab('transactions')}
          >
            <span className="material-symbols-outlined">list_alt</span>
            <span>Lançamentos</span>
          </button>

          <button 
            className={`nav-link ${activeTab === 'suppliers' ? 'active' : ''}`}
            onClick={() => setActiveTab('suppliers')}
          >
            <span className="material-symbols-outlined">local_shipping</span>
            <span>Fornecedores</span>
          </button>

          <button 
            className={`nav-link ${activeTab === 'banks' ? 'active' : ''}`}
            onClick={() => setActiveTab('banks')}
          >
            <span className="material-symbols-outlined">account_balance</span>
            <span>Bancos</span>
          </button>

          <button 
            className={`nav-link ${activeTab === 'ai' ? 'active' : ''}`}
            onClick={() => setActiveTab('ai')}
          >
            <span className="material-symbols-outlined">smart_toy</span>
            <span>Agente IA</span>
          </button>
        </nav>

        <div className="nav-footer" style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button 
            className={`nav-link ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => setActiveTab('settings')}
          >
            <span className="material-symbols-outlined">settings</span>
            <span>Configurações</span>
          </button>

          <button 
            className="nav-link"
            onClick={() => supabase.auth.signOut()}
            style={{ color: 'var(--danger)' }}
          >
            <span className="material-symbols-outlined">logout</span>
            <span>Sair</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        <header className="header-modern">
          <div className="search-container">
            <span className="material-symbols-outlined search-icon">search</span>
            <input 
              type="text" 
              className="search-input" 
              placeholder="Pesquisar transações, relatórios..." 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', padding: '0 0.5rem' }}
              >
                <X size={16} />
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', borderRight: '1px solid var(--glass-border)', paddingRight: '1.5rem' }}>
              <div 
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
                onClick={() => setIsSettingsOpen(true)}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: waStatus === 'connected' ? 'var(--success)' : '#64748b', boxShadow: waStatus === 'connected' ? '0 0 8px var(--success)' : 'none' }}></div>
                <span style={{ fontSize: '0.65rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', tracking: '0.05em' }}>WhatsApp {waStatus === 'connected' ? 'On' : 'Off'}</span>
              </div>
              <div 
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}
                onClick={() => setActiveTab('ai')}
              >
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--primary)', boxShadow: '0 0 8px var(--primary)' }}></div>
                <span style={{ fontSize: '0.65rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', tracking: '0.05em' }}>IA Ativa</span>
              </div>
            </div>
            
            <div style={{ position: 'relative' }}>
              <button 
                id="notification-bell"
                onClick={() => {
                  setIsNotificationPanelOpen(!isNotificationPanelOpen);
                  if (!isNotificationPanelOpen) {
                    setUnreadCount(0);
                  }
                }}
                style={{ 
                  background: isNotificationPanelOpen ? 'var(--primary-bg)' : 'rgba(255,255,255,0.05)', 
                  border: '1px solid var(--glass-border)', 
                  borderRadius: '0.75rem', 
                  width: '40px', 
                  height: '40px', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyChild: 'center', // error in previous code fixed
                  justifyContent: 'center', 
                  color: isNotificationPanelOpen ? 'var(--primary)' : 'var(--text-muted)', 
                  cursor: 'pointer',
                  position: 'relative'
                }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: '1.25rem' }}>notifications</span>
                {unreadCount > 0 && (
                  <span className="notification-badge">{unreadCount}</span>
                )}
              </button>

              {isNotificationPanelOpen && (
                <div className="notifications-dropdown">
                  <div className="notifications-header">
                    <span style={{ fontWeight: '800', fontSize: '0.9rem' }}>Notificações</span>
                    <button 
                      onClick={() => setNotificationHistory([])}
                      style={{ background: 'none', border: 'none', color: 'var(--primary)', fontSize: '0.75rem', fontWeight: '700', cursor: 'pointer' }}
                    >
                      Limpar tudo
                    </button>
                  </div>
                  <div className="notifications-list">
                    {notificationHistory.length === 0 ? (
                      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                        Nenhuma notificação recente
                      </div>
                    ) : (
                      notificationHistory.map(n => (
                        <div key={n.id} className="notification-item">
                          <div className={`notification-icon`} style={{ background: n.type === 'error' ? '#fee2e2' : n.type === 'info' ? '#eef2ff' : '#dcfce7', color: n.type === 'error' ? 'var(--danger)' : n.type === 'info' ? 'var(--primary)' : 'var(--success)' }}>
                            <span className="material-symbols-outlined" style={{ fontSize: '1.25rem' }}>
                              {n.type === 'error' ? 'error' : n.type === 'info' ? 'smart_toy' : 'check_circle'}
                            </span>
                          </div>
                          <div className="notification-content">
                            <p className="notification-msg">{n.message}</p>
                            <p className="notification-time">{n.time}</p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div style={{ width: 40, height: 40, borderRadius: '0.75rem', background: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              <span className="material-symbols-outlined" style={{ color: 'white' }}>person</span>
            </div>
          </div>
        </header>

        <div style={{ padding: '2rem', flex: 1, display: 'flex', flexDirection: 'column', gap: '0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
            <div>
              <h2 style={{ fontSize: '1.75rem', fontWeight: '800', lineHeight: 1.2 }}>
                {activeTab === 'dashboard'     && 'Resumo Financeiro'}
                {activeTab === 'transactions'  && 'Histórico de Lançamentos'}
                {activeTab === 'suppliers'     && 'Gestão de Fornecedores'}
                {activeTab === 'banks'         && 'Perfis Bancários'}
                {activeTab === 'ai'            && 'Agente IA'}
                {activeTab === 'settings'      && 'Configurações Globais'}
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.25rem' }}>
                {activeTab === 'dashboard'    && 'Acompanhe seu desempenho em tempo real'}
                {activeTab === 'transactions' && 'Controle suas entradas e saídas'}
                {activeTab === 'suppliers'    && 'Mapeie fornecedores para categorização automática'}
                {activeTab === 'banks'        && 'Configure identificadores de cada conta bancária'}
                {activeTab === 'ai'           && 'Gerencie comportamento e logs do processamento'}
                {activeTab === 'settings'     && 'Gerencie conexões, APIs e preferências'}
              </p>
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
              <button className="btn-secondary" onClick={fetchStats} title="Atualizar dados" style={{ padding: '0.55rem' }}>
                <RefreshCw size={17} className={loading ? 'animate-spin' : ''} />
              </button>
              <button className="btn-primary" onClick={() => setIsUploading(true)} disabled={loading}>
                <Plus size={17} />
                Novo Lançamento
              </button>
            </div>
          </div>


      {pendingTransactions.length > 0 && (
        <div className="glass-card" style={{ marginBottom: '2rem', border: '1px solid var(--primary)', background: 'rgba(99, 102, 241, 0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <h2>Revisar Lançamentos</h2>
              <div className="glass-card" style={{ padding: '0.4rem 0.8rem', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'rgba(99, 102, 241, 0.1)' }}>
                <Tag size={16} color="var(--primary)" />
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Mudar tudo para:</span>
                <select
                  className="glass-input"
                  style={{ padding: '0.2rem', fontSize: '0.8rem', border: 'none', background: 'transparent' }}
                  onChange={(e) => applyGlobalCategory(e.target.value)}
                  defaultValue=""
                >
                  <option value="" disabled>Selecionar...</option>
                  {categories.map(cat => (
                    <option key={cat} value={cat} style={{ background: 'var(--bg-dark)' }}>{cat}</option>
                  ))}
                </select>
                <button
                  onClick={handleAddCategory}
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', padding: '2px' }}
                  title="Criar nova categoria"
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <button className="btn-secondary" onClick={() => setPendingTransactions([])} disabled={loading}>
                Descartar Tudo
              </button>
              <button className="btn-primary" onClick={handleSaveToDb} disabled={loading} style={{ background: 'var(--success)', padding: '0.75rem 1.5rem' }}>
                <CheckCircle size={18} style={{ marginRight: '8px' }} />
                Confirmar e Salvar {pendingTransactions.length} Lançamentos
              </button>
            </div>
          </div>

          <div style={{ overflowX: 'auto', maxHeight: '450px' }}>
            <table style={{ minWidth: '1200px', width: '100%', borderCollapse: 'collapse' }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1, backdropFilter: 'blur(12px)' }}>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--glass-border)' }}>
                  <th style={{ padding: '1rem' }}>Data/Mês</th>
                  <th style={{ padding: '1rem' }}>Descrição</th>
                  <th style={{ padding: '1rem' }}>Categoria</th>
                  <th style={{ padding: '1rem' }}>Tipo/Pag</th>
                  <th style={{ padding: '1rem' }}>Parcela/Banco</th>
                  <th style={{ padding: '1rem' }}>Valor (R$)</th>
                  <th style={{ padding: '1rem', width: '50px' }}></th>
                </tr>
              </thead>
              <tbody>
                {pendingTransactions.map((tr, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--glass-border)' }}>
                    <td style={{ padding: '0.5rem 1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <input className="glass-input" value={tr['Data']} onChange={(e) => updateTransaction(idx, 'Data', e.target.value)} style={{ width: '90px', fontSize: '0.75rem' }} />
                        <input className="glass-input" value={tr['Mês']} onChange={(e) => updateTransaction(idx, 'Mês', e.target.value)} style={{ width: '90px', fontSize: '0.75rem', opacity: 0.7 }} />
                      </div>
                    </td>
                    <td style={{ padding: '0.5rem 1rem' }}>
                      <input className="glass-input" value={tr['Descrição']} onChange={(e) => updateTransaction(idx, 'Descrição', e.target.value)} style={{ width: '100%' }} />
                    </td>
                    <td style={{ padding: '0.5rem 1rem' }}>
                      <select
                        className="glass-input"
                        value={tr['Categoria']}
                        onChange={(e) => updateTransaction(idx, 'Categoria', e.target.value)}
                        style={{ width: '100%', background: 'var(--bg-dark)' }}
                      >
                        {categories.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: '0.5rem 1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <select
                          className="glass-input"
                          value={tr['Tipo']}
                          onChange={(e) => updateTransaction(idx, 'Tipo', e.target.value)}
                          style={{ width: '100px', fontSize: '0.75rem', background: 'var(--bg-dark)' }}
                        >
                          {TRANSACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <select
                          className="glass-input"
                          value={tr['Tipo de Pagamento']}
                          onChange={(e) => updateTransaction(idx, 'Tipo de Pagamento', e.target.value)}
                          style={{ width: '100px', fontSize: '0.75rem', background: 'var(--bg-dark)', opacity: 0.8 }}
                        >
                          {PAY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                    </td>
                    <td style={{ padding: '0.5rem 1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <input className="glass-input" value={tr['Parcela']} onChange={(e) => updateTransaction(idx, 'Parcela', e.target.value)} style={{ width: '120px', fontSize: '0.75rem' }} />
                        <input className="glass-input" value={tr['Banco/Cartão']} onChange={(e) => updateTransaction(idx, 'Banco/Cartão', e.target.value)} style={{ width: '120px', fontSize: '0.75rem', opacity: 0.7 }} />
                      </div>
                    </td>
                    <td style={{ padding: '0.5rem 1rem' }}>
                      <input
                        className="glass-input"
                        value={tr['Valor (R$)']}
                        onChange={(e) => updateTransaction(idx, 'Valor (R$)', e.target.value)}
                        style={{
                          width: '80px',
                          color: tr['Tipo'] === 'Entrada' ? 'var(--success)' : 'var(--danger)',
                          fontWeight: 'bold'
                        }}
                      />
                    </td>
                    <td style={{ padding: '0.5rem 1rem' }}>
                      <button onClick={() => removeTransaction(idx)} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'dashboard' && (
        <div className="dashboard-container" style={{ animation: 'fadeIn 0.5s ease' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2.5rem' }}>
            <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
              {[
                { id: 'hoje', label: 'Hoje' },
                { id: 'mes',  label: 'Este Mês' },
                { id: 'ano',  label: 'Este Ano' },
                { id: 'personalizado', label: 'Personalizado', icon: <Calendar size={15} /> }
              ].map(f => (
                <button
                  key={f.id}
                  onClick={() => setQuickFilter(f.id)}
                  className={activeFilter === f.id ? 'btn-primary' : 'btn-secondary'}
                  style={{
                    background: activeFilter === f.id ? undefined : 'white',
                    border: activeFilter === f.id ? undefined : '1px solid var(--glass-border)',
                    padding: '0.6rem 1.25rem',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem'
                  }}
                >
                  {f.icon && f.icon}
                  {f.label}
                </button>
              ))}

              {activeFilter === 'personalizado' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'white', border: '1px solid var(--glass-border)', borderRadius: '0.75rem', padding: '0.4rem 0.75rem' }}>
                  <input
                    type="date"
                    className="glass-input"
                    style={{ padding: '0.2rem', fontSize: '0.78rem', border: 'none', background: 'transparent', color: 'var(--text-main)' }}
                    value={dateFilters.startDate}
                    onChange={(e) => setDateFilters({ ...dateFilters, startDate: e.target.value })}
                  />
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>→</span>
                  <input
                    type="date"
                    className="glass-input"
                    style={{ padding: '0.2rem', fontSize: '0.78rem', border: 'none', background: 'transparent', color: 'var(--text-main)' }}
                    value={dateFilters.endDate}
                    onChange={(e) => setDateFilters({ ...dateFilters, endDate: e.target.value })}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.25rem', marginBottom: '2.5rem' }}>
            {/* Total Entradas */}
            <div className="glass-card" style={{ padding: '1.75rem', border: '1px solid var(--glass-border)', position: 'relative' }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                 <div style={{ padding: '0.6rem', background: '#dcfce7', borderRadius: '0.75rem', color: '#16a34a' }}>
                    <ArrowUpCircle size={20} />
                 </div>
                 <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#16a34a', background: 'rgba(22, 163, 74, 0.1)', padding: '4px 8px', borderRadius: '6px' }}>+12.5%</div>
               </div>
               <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '500' }}>Total Entradas</p>
               <h3 style={{ fontSize: '1.6rem', fontWeight: '800', marginTop: '0.4rem' }}>R$ {stats.entradas}</h3>
               <div style={{ height: '24px', width: '100%', background: 'linear-gradient(90deg, transparent, #dcfce7)', marginTop: '1rem', borderRadius: '4px', opacity: 0.5 }}></div>
            </div>

            {/* Total Saídas */}
            <div className="glass-card" style={{ padding: '1.75rem', border: '1px solid var(--glass-border)' }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                 <div style={{ padding: '0.6rem', background: '#fee2e2', borderRadius: '0.75rem', color: '#ef4444' }}>
                    <ArrowDownCircle size={20} />
                 </div>
                 <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#ef4444', background: 'rgba(239, 68, 68, 0.1)', padding: '4px 8px', borderRadius: '6px' }}>-4.2%</div>
               </div>
               <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '500' }}>Total Saídas</p>
               <h3 style={{ fontSize: '1.6rem', fontWeight: '800', marginTop: '0.4rem' }}>R$ {stats.saidas}</h3>
               <div style={{ height: '24px', width: '100%', background: 'linear-gradient(90deg, transparent, #fee2e2)', marginTop: '1rem', borderRadius: '4px', opacity: 0.5 }}></div>
            </div>

            {/* Saldo Global */}
            <div className="glass-card" style={{ padding: '1.75rem', border: '1px solid var(--primary)', background: 'rgba(99,102,241,0.03)' }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                 <div style={{ padding: '0.6rem', background: '#ede9fe', borderRadius: '0.75rem', color: '#6366f1' }}>
                    <Wallet size={20} />
                 </div>
                 <div style={{ fontSize: '0.65rem', fontWeight: 'bold', color: 'var(--primary)', textTransform: 'uppercase' }}>Saldo Geral</div>
               </div>
               <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '500' }}>Saldo Acumulado</p>
               <h3 style={{ fontSize: '1.6rem', fontWeight: '800', marginTop: '0.4rem', color: 'var(--primary)' }}>R$ {stats.total}</h3>
               <div style={{ height: '24px', width: '100%', background: 'linear-gradient(90deg, transparent, #ede9fe)', marginTop: '1rem', borderRadius: '4px', opacity: 0.5 }}></div>
            </div>

            {/* Resultado do Período */}
            <div className="glass-card" style={{ padding: '1.75rem', border: '1px solid var(--glass-border)' }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                 <div style={{ padding: '0.6rem', background: 'rgba(99, 102, 241, 0.1)', borderRadius: '0.75rem', color: '#6366f1' }}>
                    <BarChart2 size={20} />
                 </div>
                 <div style={{ fontSize: '0.65rem', fontWeight: 'bold', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Balanço do Filtro</div>
               </div>
               <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '500' }}>Fluxos do Período</p>
               <h3 style={{ fontSize: '1.6rem', fontWeight: '800', marginTop: '0.4rem', color: parseFloat(stats.totalPeriodo?.replace(',','.')) >= 0 ? 'var(--success)' : 'var(--danger)' }}>R$ {stats.totalPeriodo}</h3>
               <div style={{ height: '24px', width: '100%', background: 'linear-gradient(90deg, transparent, rgba(99, 102, 241, 0.1))', marginTop: '1rem', borderRadius: '4px', opacity: 0.5 }}></div>
            </div>

            {/* Total Investido */}
            <div className="glass-card" style={{ padding: '1.75rem', border: '1px solid var(--glass-border)' }}>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                 <div style={{ padding: '0.6rem', background: '#fef3c7', borderRadius: '0.75rem', color: '#d97706' }}>
                    <PieIcon size={20} />
                 </div>
                 <div style={{ fontSize: '0.75rem', fontWeight: 'bold', color: '#d97706', background: 'rgba(217, 119, 6, 0.1)', padding: '4px 8px', borderRadius: '6px' }}>+2.1%</div>
               </div>
               <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: '500' }}>Total Investido</p>
               <h3 style={{ fontSize: '1.6rem', fontWeight: '800', marginTop: '0.4rem' }}>R$ {stats.investido}</h3>
               <div style={{ height: '24px', width: '100%', background: 'linear-gradient(90deg, transparent, #fef3c7)', marginTop: '1rem', borderRadius: '4px', opacity: 0.5 }}></div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: '1.5rem', marginBottom: '1.5rem' }}>
            <div className="glass-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '1rem' }}>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: '800' }}>Evolução de Fluxo de Caixa</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Entradas vs Saídas mensal</p>
                </div>
                <select className="glass-input" style={{ fontSize: '0.75rem', padding: '0.4rem 0.8rem', border: '1px solid var(--glass-border)', background: 'white' }}>
                  <option>Últimos 6 meses</option>
                </select>
              </div>
              <div style={{ height: '300px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={stats.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorMain" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.03)" vertical={false} />
                    <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} dy={10} />
                    <YAxis hide />
                    <Tooltip cursor={{ stroke: '#6366f1', strokeWidth: 1 }} contentStyle={{ borderRadius: '1rem', border: 'none', boxShadow: '0 10px 15px rgba(0,0,0,0.1)' }} />
                    <Area type="monotone" dataKey="entradas" stroke="#6366f1" strokeWidth={3} fill="url(#colorMain)" />
                    <Area type="monotone" dataKey="saidas" stroke="#ef4444" strokeWidth={2} strokeDasharray="4 4" fill="transparent" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="glass-card">
               <h3 style={{ fontSize: '1.1rem', fontWeight: '800', marginBottom: '0.5rem' }}>Gastos por Categoria</h3>
               <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>Distribuição mensal</p>
               <div style={{ height: '220px', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ position: 'absolute', textAlign: 'center', zIndex: 2 }}>
                     <h2 style={{ fontSize: '1.75rem', fontWeight: '900', color: 'var(--text-main)' }}>100%</h2>
                     <p style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 'bold', textTransform: 'uppercase' }}>Total Gastos</p>
                  </div>
                  {/* Donut Simulado Premium */}
                  <div style={{ width: '180px', height: '180px', borderRadius: '50%', border: '16px solid #f8fafc', position: 'relative' }}>
                    <div style={{ position: 'absolute', top: '-16px', left: '-16px', width: '180px', height: '180px', borderRadius: '50%', border: '16px solid #059669', borderBottomColor: 'transparent', borderRightColor: 'transparent', transform: 'rotate(45deg)', zIndex: 1 }}></div>
                    <div style={{ position: 'absolute', top: '-16px', left: '-16px', width: '180px', height: '180px', borderRadius: '50%', border: '16px solid #6366f1', borderTopColor: 'transparent', borderLeftColor: 'transparent', transform: 'rotate(-45deg)', opacity: 0.8 }}></div>
                  </div>
               </div>
               <div style={{ marginTop: '2rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  {stats.categoryList.slice(0, 4).map((cat, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: ['#6366f1', '#10b981', '#f59e0b', '#3b82f6'][idx] || '#cbd5e1' }}></div>
                        <span style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--text-main)' }}>{cat.name}</span>
                      </div>
                      <span style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)' }}>{Math.round((cat.value / (parseFloat(stats.saidas.replace(/\D/g, ''))/100) || 1))}%</span>
                    </div>
                  ))}
               </div>
            </div>
          </div>

          <div className="glass-card" style={{ padding: '1.5rem 2rem' }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: '800' }}>Lançamentos Recentes</h3>
                <button 
                  onClick={() => setActiveTab('transactions')}
                  style={{ background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 'bold', fontSize: '0.85rem', cursor: 'pointer' }}
                >
                  Ver todos
                </button>
             </div>
             <table style={{ width: '100%', borderCollapse: 'collapse' }}>
               <tbody>
                 {filteredTransactions.slice(0, 5).map(tr => (
                   <tr key={tr.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                     <td style={{ padding: '1rem 0', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <div style={{ padding: '0.5rem', background: tr['Tipo'] === 'Entrada' ? '#dcfce7' : '#f1f5f9', borderRadius: '0.5rem', color: tr['Tipo'] === 'Entrada' ? '#16a34a' : 'var(--text-muted)' }}>
                          <span className="material-symbols-outlined">{tr['Tipo'] === 'Entrada' ? 'add' : 'remove'}</span>
                        </div>
                        <div>
                          <p style={{ fontWeight: '700', fontSize: '0.9rem' }}>{tr['Descrição']}</p>
                          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{tr['Data']}</p>
                        </div>
                     </td>
                     <td style={{ padding: '1rem 0', textAlign: 'right' }}>
                        <p style={{ fontWeight: '800', color: tr['Tipo'] === 'Entrada' ? 'var(--success)' : 'var(--text-main)' }}>
                          {tr['Tipo'] === 'Entrada' ? '+' : '-'} R$ {tr['Valor (R$)']}
                        </p>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{tr['Categoria']}</p>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
          </div>
        </div>
      )}

      {activeTab === 'transactions' && (
        <div className="page-section">
          <div className="glass-card">
            <div className="section-header" style={{ marginBottom: '1.5rem' }}>
              <div>
                <h2 className="section-title">
                  <BarChart2 size={22} color="var(--primary)" />
                  Histórico de Lançamentos
                </h2>
                <p className="section-subtitle">{filteredTransactions.length} lançamento(s) encontrado(s)</p>
              </div>
              <button className="btn-secondary" onClick={fetchStats} title="Atualizar">
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                Atualizar
              </button>
            </div>

            <div style={{ overflowX: 'auto', maxHeight: '600px' }}>
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Descrição</th>
                    <th>Categoria</th>
                    <th>Tipo</th>
                    <th>Conta / Cartão</th>
                    <th>Valor (R$)</th>
                    <th style={{ textAlign: 'center' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTransactions.length > 0 ? filteredTransactions.map((tr) => (
                    <tr key={tr.id}>
                      <td style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{tr['Data']}</td>
                      <td style={{ fontWeight: '600' }}>{tr['Descrição']}</td>
                      <td>
                        <span className="badge badge-neutral">{tr['Categoria']}</span>
                      </td>
                      <td>
                        <span className={`badge ${tr['Tipo'] === 'Entrada' ? 'badge-success' : 'badge-danger'}`}>
                          {tr['Tipo']}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{tr['Banco/Cartão'] || '-'}</td>
                      <td style={{ fontWeight: '700', color: tr['Tipo'] === 'Entrada' ? 'var(--success)' : 'var(--text-main)', whiteSpace: 'nowrap' }}>
                        {tr['Tipo'] === 'Entrada' ? '+' : '-'} R$ {tr['Valor (R$)']}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'center' }}>
                          <button
                            className="action-btn primary"
                            title="Editar"
                            onClick={() => handleEditTransaction({
                              id: tr.id,
                              'Data': tr['Data'], 'Mês': tr['Mês'], 'Descrição': tr['Descrição'],
                              'Tipo': tr['Tipo'], 'Tipo de Pagamento': tr['Tipo de Pagamento'],
                              'Parcela': tr['Parcela'], 'Banco/Cartão': tr['Banco/Cartão'],
                              'Categoria': tr['Categoria'], 'Valor (R$)': tr['Valor (R$)']
                            })}
                          >
                            <Tag size={15} />
                          </button>
                          <button className="action-btn danger" title="Excluir" onClick={() => handleDeleteTransaction(tr.id)}>
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                        Nenhuma transação encontrada.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Edit Transaction Modal */}
      {editingTransaction && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '500px' }}>
            <button
              onClick={() => setEditingTransaction(null)}
              style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
            >
              <X size={24} />
            </button>
            <h2 style={{ marginBottom: '1.5rem' }}>Editar Lançamento</h2>

            <div style={{ display: 'grid', gap: '1rem' }}>
              <div className="form-group">
                <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Descrição</label>
                <input
                  className="glass-input"
                  style={{ width: '100%', padding: '0.75rem' }}
                  value={editingTransaction['Descrição']}
                  onChange={(e) => setEditingTransaction({ ...editingTransaction, 'Descrição': e.target.value })}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Valor (R$)</label>
                  <input
                    className="glass-input"
                    style={{ width: '100%', padding: '0.75rem' }}
                    value={editingTransaction['Valor (R$)']}
                    onChange={(e) => setEditingTransaction({ ...editingTransaction, 'Valor (R$)': e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Categoria</label>
                  <select
                    className="glass-input"
                    style={{ width: '100%', padding: '0.75rem', background: 'var(--bg-dark)' }}
                    value={editingTransaction.Categoria}
                    onChange={(e) => setEditingTransaction({ ...editingTransaction, Categoria: e.target.value })}
                  >
                    {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Tipo</label>
                  <select
                    className="glass-input"
                    style={{ width: '100%', padding: '0.75rem', background: 'var(--bg-dark)' }}
                    value={editingTransaction.Tipo}
                    onChange={(e) => setEditingTransaction({ ...editingTransaction, Tipo: e.target.value })}
                  >
                    {TRANSACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Pagamento</label>
                  <select
                    className="glass-input"
                    style={{ width: '100%', padding: '0.75rem', background: 'var(--bg-dark)' }}
                    value={editingTransaction['Tipo de Pagamento']}
                    onChange={(e) => setEditingTransaction({ ...editingTransaction, 'Tipo de Pagamento': e.target.value })}
                  >
                    {PAY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '1rem' }}>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Banco / Cartão</label>
                  <input
                    className="glass-input"
                    style={{ width: '100%', padding: '0.75rem' }}
                    value={editingTransaction['Banco/Cartão'] || ''}
                    onChange={(e) => setEditingTransaction({ ...editingTransaction, 'Banco/Cartão': e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label style={{ display: 'block', fontSize: '0.8rem', marginBottom: '0.5rem', color: 'var(--text-muted)' }}>Data</label>
                  <input
                    className="glass-input"
                    style={{ width: '100%', padding: '0.75rem' }}
                    value={editingTransaction['Data']}
                    onChange={(e) => setEditingTransaction({ ...editingTransaction, 'Data': e.target.value })}
                  />
                </div>
              </div>
            </div>

            <button
              onClick={handleSaveEdit}
              className="btn-primary"
              style={{ width: '100%', padding: '1rem', marginTop: '2rem', fontSize: '1.1rem' }}
              disabled={loading}
            >
              {loading ? <Loader2 className="animate-spin" size={20} /> : <CheckCircle size={20} style={{ marginRight: '8px' }} />}
              Salvar Alterações
            </button>
          </div>
        </div>
      )}

      {/* Fornecedores View */}
      {activeTab === 'suppliers' && (
        <div className="page-section">
          {/* Formulário */}
          <div className="glass-card">
            <div className="section-header" style={{ marginBottom: '1.25rem' }}>
              <div>
                <h2 className="section-title">
                  <Send size={20} color="var(--primary)" />
                  Mapeamento de Fornecedores
                </h2>
                <p className="section-subtitle">Cadastre nomes para categorização automática</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="form-group" style={{ flex: '1', minWidth: '200px' }}>
                <label>Nome do Fornecedor / Loja</label>
                <input
                  className="glass-input"
                  placeholder="Ex: Uber, Mercado Livre..."
                  value={newSupplier.nome}
                  onChange={(e) => setNewSupplier({ ...newSupplier, nome: e.target.value })}
                />
              </div>
              <div className="form-group" style={{ flex: '1', minWidth: '180px' }}>
                <label>Categoria Automática</label>
                <select
                  className="glass-input"
                  value={newSupplier.categoria}
                  onChange={(e) => setNewSupplier({ ...newSupplier, categoria: e.target.value })}
                >
                  {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end', paddingBottom: '0' }}>
                <button className="btn-primary" onClick={handleSaveSupplier} disabled={loading}>
                  <Plus size={16} />
                  {editingSupplier ? 'Atualizar' : 'Cadastrar'}
                </button>
                {editingSupplier && (
                  <button className="btn-secondary" onClick={() => { setEditingSupplier(null); setNewSupplier({ nome: '', categoria: 'Outros' }); }}>
                    <X size={16} /> Cancelar
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Tabela */}
          <div className="glass-card">
            <div className="section-header" style={{ marginBottom: '1rem' }}>
              <p className="section-subtitle">{suppliers.length} fornecedor(es) cadastrado(s)</p>
              <button className="btn-secondary" onClick={fetchSuppliers}>
                <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="modern-table">
                <thead>
                  <tr>
                    <th>Fornecedor / Loja</th>
                    <th>Categoria Atribuída</th>
                    <th style={{ textAlign: 'center' }}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {suppliers.length > 0 ? suppliers.map((sup) => (
                    <tr key={sup.id}>
                      <td style={{ fontWeight: '600' }}>{sup.nome}</td>
                      <td><span className="badge badge-primary">{sup.categoria}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'center' }}>
                          <button className="action-btn primary" title="Editar" onClick={() => handleEditSupplierClick(sup)}><Tag size={15} /></button>
                          <button className="action-btn danger" title="Excluir" onClick={() => handleDeleteSupplier(sup.id)}><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="3" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Nenhum fornecedor cadastrado.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Bancos / Bank Profiles View */}
      {activeTab === 'banks' && (
        <div className="page-section">
          <div className="glass-card">
            <div className="section-header" style={{ marginBottom: '1.25rem' }}>
              <div>
                <h2 className="section-title"><CreditCard size={20} color="var(--primary)" /> Perfis Bancários</h2>
                <p className="section-subtitle">Configure identificadores e final do cartão para reconhecimento automático</p>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <div className="form-group"><label>Nome do Banco</label><input className="glass-input" placeholder="Ex: C6 Bank" value={newBankProfile.nome} onChange={(e) => setNewBankProfile({ ...newBankProfile, nome: e.target.value })} /></div>
              <div className="form-group"><label>ID Gemini</label><input className="glass-input" placeholder="Ex: C6" value={newBankProfile.identificador} onChange={(e) => setNewBankProfile({ ...newBankProfile, identificador: e.target.value })} /></div>
              <div className="form-group"><label>Final do Cartão</label><input className="glass-input" placeholder="Ex: 2623" value={newBankProfile.cartao_final} onChange={(e) => setNewBankProfile({ ...newBankProfile, cartao_final: e.target.value })} /></div>
              <div className="form-group"><label>Palavras Ignorar (vírgula)</label><input className="glass-input" placeholder="Ex: Cartao final, IOF" value={newBankProfile.palavras_ignorar} onChange={(e) => setNewBankProfile({ ...newBankProfile, palavras_ignorar: e.target.value })} /></div>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn-primary" onClick={async () => {
                if (!newBankProfile.nome || !newBankProfile.identificador) return showToast('Preencha os campos obrigatórios', 'error');
                try {
                  if (editingBankProfile) { 
                    await axios.put(`${API_URL}/bank-profiles/${editingBankProfile.id}`, newBankProfile); 
                    showToast('Perfil atualizado!'); 
                  } else { 
                    await axios.post(`${API_URL}/bank-profiles`, newBankProfile); 
                    showToast('Perfil criado!'); 
                  }
                  setNewBankProfile({ nome: '', identificador: '', palavras_ignorar: '', cartao_final: '' }); 
                  setEditingBankProfile(null); 
                  fetchBankProfiles();
                } catch (err) { 
                  showToast('Erro ao salvar', 'error'); 
                }
              }}><Plus size={16} /> {editingBankProfile ? 'Salvar' : 'Adicionar'}</button>
              {editingBankProfile && <button className="btn-secondary" onClick={() => { setEditingBankProfile(null); setNewBankProfile({ nome: '', identificador: '', palavras_ignorar: '', cartao_final: '' }); }}><X size={15} /> Cancelar</button>}
            </div>
          </div>

          <div className="glass-card">
            <div className="section-header" style={{ marginBottom: '1rem' }}>
              <p className="section-subtitle">{bankProfiles.length} perfil(s) configurado(s)</p>
              <button className="btn-secondary" onClick={fetchBankProfiles}><RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Atualizar</button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="modern-table">
                <thead><tr><th>Banco</th><th>ID Gemini</th><th>Cartão</th><th>Ignorar</th><th style={{ textAlign: 'center' }}>Ações</th></tr></thead>
                <tbody>
                  {bankProfiles.length > 0 ? bankProfiles.map((bp) => (
                    <tr key={bp.id}>
                      <td><span style={{ fontWeight: '700', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><CreditCard size={14} color="var(--primary)" /> {bp.nome}</span></td>
                      <td><span className="badge badge-neutral">{bp.identificador}</span></td>
                      <td style={{ fontFamily: 'monospace' }}>{bp.cartao_final ? `**** ${bp.cartao_final}` : '-'}</td>
                      <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)', maxWidth: '200px' }}>{bp.palavras_ignorar}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'center' }}>
                          <button className="action-btn primary" title="Editar" onClick={() => { setEditingBankProfile(bp); setNewBankProfile({ ...bp }); }}><Tag size={15} /></button>
                          <button className="action-btn danger" title="Excluir" onClick={async () => { if (window.confirm('Excluir perfil?')) { await axios.delete(`${API_URL}/bank-profiles/${bp.id}`); fetchBankProfiles(); } }}><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr><td colSpan="5" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>Nenhum perfil configurado.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'ai' && (
        <div className="page-section">
          <div className="glass-card">
            <div className="section-header" style={{ marginBottom: '1.5rem' }}>
              <div>
                <h2 className="section-title"><Bot size={22} color="var(--primary)" /> Agente de Inteligência Artificial</h2>
                <p className="section-subtitle">Defina o comportamento e monitore os logs do processamento</p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="btn-secondary" onClick={fetchAiLogs}><RefreshCw size={15} /> Logs</button>
                <button className="btn-secondary" onClick={clearAiLogs} style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}><Trash2 size={15} /> Limpar</button>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 1.5fr', gap: '2rem' }}>
              {/* Esquerda */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div className="form-group">
                  <label>System Prompt — Instruções da IA</label>
                  <textarea
                    className="glass-input"
                    placeholder="Ex: Ignore comprovantes de agendamento. Seja rigoroso com faturas do C6 Bank..."
                    style={{ height: '280px', lineHeight: '1.6', resize: 'vertical' }}
                    value={geminiSystemPrompt}
                    onChange={(e) => setGeminiSystemPrompt(e.target.value)}
                  />
                </div>
                <button className="btn-primary" style={{ justifyContent: 'center' }} onClick={saveGeminiSystemPrompt}>
                  <Shield size={16} /> Salvar Instruções
                </button>

                <div style={{ borderTop: '1px solid var(--glass-border)', paddingTop: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <p style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Chaves de Acesso</p>
                  <div className="form-group">
                    <label>Google Gemini API Key</label>
                    <input type="password" className="glass-input" value={geminiApiKey} onChange={(e) => setGeminiApiKey(e.target.value)} onBlur={saveGeminiApiKey} placeholder="AIzaSy..." />
                  </div>
                  <div className="form-group">
                    <label>Número WhatsApp Autorizado</label>
                    <input className="glass-input" value={authorizedNumber} onChange={(e) => setAuthorizedNumber(e.target.value)} onBlur={saveAuthorizedNumber} />
                  </div>
                </div>
              </div>

              {/* Direita: Terminal */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <p style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Logs do Agente</p>
                <div className="terminal">{aiLogs || 'Aguardando processamento...'}</div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>💡 Os logs mostram as decisões da IA em tempo real.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'settings' && (
        <div style={{ animation: 'fadeIn 0.5s ease' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
            {/* WhatsApp Connection Card */}
            <div className="glass-card" style={{ padding: '2rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ padding: '0.75rem', background: '#dcfce7', borderRadius: '0.75rem', color: '#16a34a' }}>
                  <Smartphone size={24} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: '800' }}>WhatsApp Bot</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Conexão com serviço Evolution API</p>
                </div>
              </div>

              <div style={{ textAlign: 'center', padding: '2rem', background: '#f8fafc', borderRadius: '1rem', marginBottom: '1.5rem', border: '1px dashed var(--glass-border)' }}>
                {waStatus === 'connected' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ width: 64, height: 64, background: '#dcfce7', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a' }}>
                      <CheckCircle size={32} />
                    </div>
                    <p style={{ fontWeight: '700', color: '#16a34a' }}>Serviço Conectado</p>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>O robô está pronto para processar mensagens.</p>
                    <button 
                      onClick={handleLogoutWhatsApp} 
                      style={{ padding: '0.5rem 1.25rem', fontSize: '0.8rem', fontWeight: 'bold', color: '#ef4444', background: '#fee2e2', border: 'none', borderRadius: '0.5rem', cursor: 'pointer', transition: 'all 0.2s' }}
                    >
                      Desconectar WhatsApp
                    </button>
                  </div>
                ) : waQr ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
                    <img src={waQr} style={{ width: '180px', borderRadius: '0.5rem', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }} alt="QR Code" />
                    <p style={{ fontSize: '0.8rem', fontWeight: '600' }}>Escaneie para conectar</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', color: 'var(--text-muted)' }}>
                    <Loader2 className="animate-spin" size={32} />
                    <p style={{ fontSize: '0.8rem' }}>Inicializando instância...</p>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label style={{ fontSize: '0.85rem', fontWeight: '700', marginBottom: '0.5rem', display: 'block' }}>Número Autorizado</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <input 
                    className="glass-input" 
                    style={{ flex: 1, padding: '0.75rem' }} 
                    placeholder="Ex: 5511999999999"
                    value={authorizedNumber} 
                    onChange={(e) => setAuthorizedNumber(e.target.value)} 
                  />
                  <button className="btn-primary" onClick={saveAuthorizedNumber}>
                    Salvar
                  </button>
                </div>
                <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                  Somente mensagens deste número serão processadas pela IA.
                </p>
              </div>

              <div className="form-group" style={{ marginTop: '1.5rem', padding: '1rem', background: 'var(--bg-main)', borderRadius: '0.75rem', border: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <label style={{ fontSize: '0.85rem', fontWeight: '700', margin: 0 }}>Analisar todas as conversas</label>
                  <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', margin: 0, marginTop: '0.2rem' }}>
                    Processa imagens mesmo quando você clica em "adicionar legenda" e envia as fotos diretamente para outros contatos.
                  </p>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', position: 'relative' }}>
                  <input 
                    type="checkbox" 
                    style={{ appearance: 'none', width: '40px', height: '20px', background: processOutgoingMessages ? 'var(--success)' : '#cbd5e1', borderRadius: '20px', outline: 'none', cursor: 'pointer', transition: '0.3s' }}
                    checked={processOutgoingMessages}
                    onChange={handleToggleOutgoing}
                  />
                  <div style={{ position: 'absolute', top: '2px', left: processOutgoingMessages ? '22px' : '2px', width: '16px', height: '16px', background: 'white', borderRadius: '50%', transition: '0.3s', pointerEvents: 'none' }} />
                </label>
              </div>
            </div>

            {/* AI Configuration Card */}
            <div className="glass-card" style={{ padding: '2rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ padding: '0.75rem', background: '#ede9fe', borderRadius: '0.75rem', color: '#6366f1' }}>
                  <Bot size={24} />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: '800' }}>Google Gemini AI</h3>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Inteligência para extração de dados</p>
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: '700', marginBottom: '0.5rem', display: 'block' }}>API Key</label>
                <input 
                  className="glass-input" 
                  type="password" 
                  style={{ width: '100%', padding: '0.75rem' }} 
                  value={geminiApiKey} 
                  onChange={(e) => setGeminiApiKey(e.target.value)} 
                  placeholder="Insira sua chave API do Google AI Studio"
                />
              </div>

              <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontSize: '0.85rem', fontWeight: '700', marginBottom: '0.5rem', display: 'block' }}>Prompt de Sistema (Personalizar Comportamento)</label>
                <textarea 
                  className="glass-input" 
                  style={{ width: '100%', minHeight: '120px', padding: '0.75rem', resize: 'vertical', fontSize: '0.85rem' }} 
                  value={geminiSystemPrompt} 
                  onChange={(e) => setGeminiSystemPrompt(e.target.value)} 
                />
              </div>
              
              <button className="btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={saveGeminiApiKey}>
                <Shield size={18} />
                Salvar Configurações de IA
              </button>

              <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#fffbeb', borderRadius: '0.75rem', border: '1px solid #fef3c7' }}>
                <p style={{ fontSize: '0.75rem', color: '#92400e', display: 'flex', gap: '0.5rem' }}>
                  <AlertCircle size={16} />
                  <span>A chave API é armazenada localmente no servidor e nunca é compartilhada.</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  </main>

      {/* Upload Modal */}
      {isUploading && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: modalView === 'manual' ? '500px' : '650px' }}>
            <button
              onClick={() => { setIsUploading(false); setModalView('select'); }}
              style={{ position: 'absolute', top: '1.5rem', right: '1.5rem', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', zIndex: 10 }}
            >
              <X size={24} />
            </button>

            {modalView === 'select' ? (
              <div style={{ animation: 'fadeIn 0.3s ease' }}>
                <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
                  <h2 style={{ fontSize: '1.75rem', fontWeight: '800', color: '#1e293b' }}>Novo Lançamento</h2>
                  <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem', fontWeight: '500' }}>Como deseja adicionar suas transações?</p>
                </div>
                
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                  {/* Card Múltiplas Imagens */}
                  <div 
                    className="glass-card" 
                    onClick={() => !loading && document.getElementById('file-upload').click()} 
                    style={{ 
                      cursor: loading ? 'default' : 'pointer', 
                      padding: '2.5rem 1.5rem', 
                      textAlign: 'center', 
                      background: 'white', 
                      border: '1.5px dashed #6366f1', 
                      display: 'flex', 
                      flexDirection: 'column', 
                      alignItems: 'center', 
                      gap: '1.5rem',
                      borderRadius: '1.25rem',
                      boxShadow: 'none'
                    }}
                  >
                    <div style={{ padding: '1.25rem', background: '#eef2ff', borderRadius: '1rem', color: '#6366f1' }}>
                      {loading ? <Loader2 className="animate-spin" size={32} /> : <Upload size={32} />}
                    </div>
                    <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#1e293b' }}>Múltiplas Imagens</h3>
                    <input type="file" multiple style={{ display: 'none' }} id="file-upload" onChange={handleFileUpload} disabled={loading} />
                  </div>

                  {/* Card Lançamento Manual */}
                  <div 
                    className="glass-card" 
                    onClick={() => !loading && setModalView('manual')} 
                    style={{ 
                      cursor: loading ? 'default' : 'pointer', 
                      padding: '2.5rem 1.5rem', 
                      textAlign: 'center', 
                      background: '#f8fafc', 
                      border: '1px solid transparent', 
                      display: 'flex', 
                      flexDirection: 'column', 
                      alignItems: 'center', 
                      gap: '1.5rem',
                      borderRadius: '1.25rem',
                      boxShadow: 'none'
                    }}
                  >
                    <div style={{ padding: '1.25rem', background: '#ecfdf5', borderRadius: '1rem', color: '#10b981' }}>
                      <Plus size={32} />
                    </div>
                    <h3 style={{ fontSize: '1rem', fontWeight: '700', color: '#1e293b' }}>Lançamento Manual</h3>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={handleManualFormSubmit}>
                <div style={{ marginBottom: '2rem' }}>
                  <button type="button" onClick={() => setModalView('select')} style={{ background: 'none', border: 'none', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>← Voltar</button>
                  <h2 style={{ fontSize: '1.5rem' }}>Dados do Gasto</h2>
                </div>
                <div style={{ display: 'grid', gap: '1.25rem' }}>
                  <div className="form-group">
                    <label>Descrição</label>
                    <input className="glass-input" style={{ width: '100%' }} value={manualFormData.Descrição} onChange={(e) => setManualFormData({ ...manualFormData, Descrição: e.target.value })} autoFocus />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                    <div className="form-group"><label>Valor (R$)</label><input className="glass-input" style={{ width: '100%' }} value={manualFormData['Valor (R$)']} onChange={(e) => setManualFormData({ ...manualFormData, 'Valor (R$)': e.target.value })} /></div>
                    <div className="form-group"><label>Categoria</label><select className="glass-input" style={{ width: '100%' }} value={manualFormData.Categoria} onChange={(e) => setManualFormData({ ...manualFormData, Categoria: e.target.value })}>{categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}</select></div>
                  </div>
                </div>
                <button type="submit" className="btn-primary" style={{ width: '100%', marginTop: '2rem' }}>Confirmar Lançamento</button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;