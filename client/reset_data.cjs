const fs = require('fs');
const path = require('path');

function writeClean(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(content, 'utf8'));
    console.log(`Atualizado: ${filePath}`);
}

const appJsx = `import React, { useState } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell 
} from 'recharts';
import { Upload, DollarSign, ArrowUpCircle, ArrowDownCircle, Wallet, Loader2 } from 'lucide-react';
import axios from 'axios';

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444'];

const App = () => {
  const [isUploading, setIsUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  
  // Estados zerados para início real
  const [chartData, setChartData] = useState([]);
  const [categoryData, setCategoryData] = useState([]);
  const [stats, setStats] = useState({
    total: "0,00",
    entradas: "0,00",
    saidas: "0,00"
  });

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('image', file);

    setLoading(true);
    setStatus('Processando OCR...');

    try {
      const response = await axios.post('http://localhost:3002/process-image', formData);
      setStatus('Sucesso! Dados enviados para a planilha.');
      console.log(response.data);
      // Aqui o usuário deve atualizar a planilha para ver os dados reais
    } catch (error) {
      console.error(error);
      setStatus('Erro ao processar imagem.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-container">
      <header className="header">
        <div>
          <h1>Finanças Pro</h1>
          <p style={{ color: 'var(--text-muted)' }}>Bem-vindo de volta, Thomas</p>
        </div>
        <button className="btn-primary" onClick={() => setIsUploading(true)} disabled={loading}>
          <Upload size={18} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
          Novo Comprovante
        </button>
      </header>

      <div className="stats-grid">
        <div className="glass-card">
          <div className="stat-label">Saldo Total</div>
          <div className="stat-value">R$ {stats.total}</div>
          <Wallet color="var(--primary)" />
        </div>
        <div className="glass-card">
          <div className="stat-label">Entradas (Mês)</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>+ R$ {stats.entradas}</div>
          <ArrowUpCircle color="var(--success)" />
        </div>
        <div className="glass-card">
          <div className="stat-label">Saídas (Mês)</div>
          <div className="stat-value" style={{ color: 'var(--danger)' }}>- R$ {stats.saidas}</div>
          <ArrowDownCircle color="var(--danger)" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className="glass-card">
          <h3>Fluxo de Caixa</h3>
          <div className="chart-container">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" />
                  <XAxis dataKey="name" stroke="var(--text-muted)" />
                  <YAxis stroke="var(--text-muted)" />
                  <Tooltip 
                    contentStyle={{ background: 'var(--bg-dark)', border: '1px solid var(--glass-border)' }}
                  />
                  <Bar dataKey="entrada" fill="var(--success)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="saida" fill="var(--danger)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                Nenhum dado para exibir. Faça upload de comprovantes!
              </div>
            )}
          </div>
        </div>

        <div className="glass-card">
          <h3>Gastos por Categoria</h3>
          <div className="chart-container">
            {categoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryData}
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {categoryData.map((entry, index) => (
                      <Cell key={"cell-" + index} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                Sem categorias.
              </div>
            )}
          </div>
        </div>
      </div>

      {isUploading && (
        <div className="glass-card" style={{ marginBottom: '2rem' }}>
          <div className="upload-zone">
            <Upload size={48} color="var(--primary)" style={{ marginBottom: '1rem' }} />
            <h3>Arraste seus prints ou comprovantes aqui</h3>
            <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Formatos suportados: JPG, PNG (máx 5MB)
            </p>
            <input 
              type="file" 
              style={{ display: 'none' }} 
              id="file-upload" 
              onChange={handleFileUpload}
              disabled={loading}
            />
            <button 
              className="btn-primary" 
              style={{ marginTop: '1.5rem' }}
              onClick={() => document.getElementById('file-upload').click()}
              disabled={loading}
            >
              {loading ? 'Processando...' : 'Selecionar Arquivo'}
            </button>
            {status && <p style={{ marginTop: '1rem', color: status.includes('Erro') ? 'var(--danger)' : 'var(--success)' }}>{status}</p>}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;`;

writeClean('src/App.jsx', appJsx);
console.log('Dados demonstrativos removidos.');
