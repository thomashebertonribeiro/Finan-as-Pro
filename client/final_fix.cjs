const fs = require('fs');
const path = require('path');

function writeClean(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  // Escreve como Buffer para garantir UTF-8 sem BOM
  fs.writeFileSync(filePath, Buffer.from(content, 'utf8'));
  console.log(`Corrigido: ${filePath}`);
}

const appJsx = `import React, { useState } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell 
} from 'recharts';
import { Upload, DollarSign, ArrowUpCircle, ArrowDownCircle, Wallet, Loader2 } from 'lucide-react';
import axios from 'axios';

const data = [
  { name: 'Jan', entrada: 4000, saida: 2400 },
  { name: 'Fev', entrada: 3000, saida: 1398 },
  { name: 'Mar', entrada: 2000, saida: 9800 },
];

const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444'];

const App = () => {
  const [isUploading, setIsUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

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
          <div className="stat-value">R$ 12.450,00</div>
          <Wallet color="var(--primary)" />
        </div>
        <div className="glass-card">
          <div className="stat-label">Entradas (Mês)</div>
          <div className="stat-value" style={{ color: 'var(--success)' }}>+ R$ 5.200,00</div>
          <ArrowUpCircle color="var(--success)" />
        </div>
        <div className="glass-card">
          <div className="stat-label">Saídas (Mês)</div>
          <div className="stat-value" style={{ color: 'var(--danger)' }}>- R$ 3.840,00</div>
          <ArrowDownCircle color="var(--danger)" />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
        <div className="glass-card">
          <h3>Fluxo de Caixa</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data}>
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
          </div>
        </div>

        <div className="glass-card">
          <h3>Gastos por Categoria</h3>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                    { name: 'Alimentação', value: 400 },
                    { name: 'Transporte', value: 300 },
                    { name: 'Lazer', value: 300 },
                  ]}
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {data.map((entry, index) => (
                    <Cell key={"cell-" + index} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
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

const indexCss = `:root {
  --primary: #6366f1;
  --primary-hover: #4f46e5;
  --bg-dark: #0f172a;
  --bg-card: rgba(30, 41, 59, 0.7);
  --text-main: #f8fafc;
  --text-muted: #94a3b8;
  --success: #10b981;
  --danger: #ef4444;
  --glass-border: rgba(255, 255, 255, 0.1);
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  background-color: var(--bg-dark);
  background-image: 
    radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.15) 0px, transparent 50%),
    radial-gradient(at 100% 0%, rgba(168, 85, 247, 0.15) 0px, transparent 50%);
  color: var(--text-main);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
}

.dashboard-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 2rem;
}

.glass-card {
  background: var(--bg-card);
  backdrop-filter: blur(12px);
  border: 1px solid var(--glass-border);
  border-radius: 1rem;
  padding: 1.5rem;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 1.5rem;
  margin-bottom: 2rem;
}

.stat-value {
  font-size: 2rem;
  font-weight: 700;
  margin: 0.5rem 0;
}

.stat-label {
  color: var(--text-muted);
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.btn-primary {
  background: var(--primary);
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 0.5rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-primary:hover {
  background: var(--primary-hover);
  transform: translateY(-1px);
}

.chart-container {
  height: 300px;
  margin-top: 1rem;
}

.upload-zone {
  border: 2px dashed var(--glass-border);
  border-radius: 1rem;
  padding: 3rem;
  text-align: center;
  transition: border-color 0.2s;
  cursor: pointer;
}

.upload-zone:hover {
  border-color: var(--primary);
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.animate-spin {
  animation: spin 1s linear infinite;
}`;

writeClean('src/App.jsx', appJsx);
writeClean('src/index.css', indexCss);

console.log('Correção final de encoding concluída.');
