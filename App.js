import React, { useState, useEffect } from 'react';
import {  
  View,
  Text,    
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  StatusBar,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase, insertAvaliacoesBatch, insertAvaliacao } from './lib/supabase';
import NetInfo from '@react-native-community/netinfo';
import AsyncStorage from '@react-native-async-storage/async-storage';




// --- DADOS DOS CRITÉRIOS DE AVALIAÇÃO ---
const CRITERIA = [
  { id: 'c1', text: 'Funcionalidade', description: 'O projeto executa todas as tarefas propostas de forma estável, sem travamentos ou erros críticos?' },
  { id: 'c2', text: 'Usabilidade e Visual', description: 'A interface é intuitiva, o design é agradável e o projeto proporciona uma boa experiência de uso?' },
  { id: 'c3', text: 'Originalidade', description: 'O projeto apresenta uma solução criativa, inovadora ou um diferencial claro em relação a projetos similares?' },
  { id: 'c4', text: 'Nível de Conclusão (Finalizado?)', description: 'O projeto foi entregue 100% polido e completo, ou ainda faltam funcionalidades para a sua conclusão?' },
  { id: 'c5', text: 'Apresentação e Entrega', description: 'O grupo demonstrou total domínio técnico sobre o projeto e o apresentou de forma clara?' },

];

const OPTIONS = [
  { label: 'Regular', value: 0.30 },
  { label: 'Bom', value: 0.70 },
  { label: 'Ótimo', value: 1.0 },
];

// --- COMPONENTE PRINCIPAL DO APP ---
export default function App() {
  const [profName, setProfName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [obs, setObs] = useState('');
  const [scores, setScores] = useState({});
  const [turma, setTurma] = useState('');
  const [totalScore, setTotalScore] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const PENDING_KEY = '@avaliacoes_pending';

  // Calcula a pontuação total sempre que as notas mudarem
  useEffect(() => {
    const total = Object.values(scores).reduce((sum, value) => sum + value, 0);
    setTotalScore(total);
  }, [scores]);

  // Função para lidar com a seleção de uma opção de avaliação
  const handleSelectScore = (criterionId, value) => {
    setScores(prevScores => ({
      ...prevScores,
      [criterionId]: value,
    }));
  };
  
  // Reseta o formulário para uma nova avaliação
  const resetForm = () => {
    setProfName('');
    setTurma('');
    setGroupName('');
    setObs('');
    setScores({});
    setTotalScore(0);
  };

  // Salva avaliação localmente (fila de pendências)
  const savePending = async (evaluationData) => {
    try {
      const raw = await AsyncStorage.getItem(PENDING_KEY);
      const list = raw ? JSON.parse(raw) : [];
      list.push({ ...evaluationData, _savedAt: new Date().toISOString() });
      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(list));
      console.log('Avaliação salva localmente (pendente).');
    } catch (e) {
      console.error('Erro ao salvar avaliação localmente:', e);
    }
  };

  // Tenta enviar todas avaliações pendentes ao Supabase
  const flushPending = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const raw = await AsyncStorage.getItem(PENDING_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (!list.length) {
        setSyncing(false);
        return;
      }

      console.log(`Sincronizando ${list.length} avaliações pendentes...`);

      // Enviar em lotes (batch). Se um lote falhar, tentar item-a-item e remover apenas os que foram enviados com sucesso.
      const BATCH_SIZE = 5;
      const remaining = [...list];
      const successfullySent = [];

      for (let i = 0; i < list.length; i += BATCH_SIZE) {
        const chunk = list.slice(i, i + BATCH_SIZE);
        const toInsert = chunk.map(item => {
          const { _savedAt, ...rest } = item;
          return rest;
        });

          try {
          const { data, error } = await insertAvaliacoesBatch(toInsert);
          if (error) {
            console.warn('Erro ao inserir lote, tentando item-a-item:', error.message || error);
            // Tentar item-a-item
            for (const item of chunk) {
              try {
                const { _savedAt, ...rest } = item;
                const { data: dItem, error: errItem } = await insertAvaliacao(rest);
                if (!errItem) {
                  successfullySent.push(item);
                } else {
                  console.warn('Falha ao enviar item:', errItem);
                }
              } catch (eItem) {
                console.error('Exceção ao enviar item:', eItem);
              }
            }
          } else {
            // lote enviado com sucesso: marcar todos os do chunk como enviados
            successfullySent.push(...chunk);
            console.log(`Lote sincronizado (${chunk.length})`);
          }
        } catch (exChunk) {
          console.error('Exceção ao enviar lote:', exChunk);
          // tentar item-a-item também
              for (const item of chunk) {
            try {
              const { _savedAt, ...rest } = item;
              const { data: dItem, error: errItem } = await insertAvaliacao(rest);
              if (!errItem) {
                successfullySent.push(item);
              } else {
                console.warn('Falha ao enviar item após exceção no lote:', errItem);
              }
            } catch (eItem) {
              console.error('Exceção ao enviar item após exceção no lote:', eItem);
            }
          }
        }
      }

      // Remover os itens enviados com sucesso da lista de pendências
      if (successfullySent.length) {
        const sentSet = new Set(successfullySent.map(it => it._savedAt));
        const stillPending = remaining.filter(it => !sentSet.has(it._savedAt));
        if (stillPending.length) {
          await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(stillPending));
          console.log(`Sincronização parcial: ${successfullySent.length} enviados, ${stillPending.length} permanecem.`);
        } else {
          await AsyncStorage.removeItem(PENDING_KEY);
          console.log('Todas pendências sincronizadas com sucesso');
        }
      } else {
        console.warn('Nenhuma pendência foi sincronizada neste ciclo. Mantendo fila para nova tentativa.');
      }
    } catch (e) {
      console.error('Exceção ao sincronizar pendências:', e);
    } finally {
      setSyncing(false);
    }
  };

  // Monitora conexão de rede e aciona flush quando online
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener(state => {
      const connected = state.isConnected && state.isInternetReachable !== false;
      setIsConnected(connected);
      if (connected) {
        flushPending();
      }
    });

    // Ao montar, checa imediatamente e tenta sincronizar se online
    (async () => {
      try {
        const state = await NetInfo.fetch();
        const connected = state.isConnected && state.isInternetReachable !== false;
        setIsConnected(connected);
        if (connected) await flushPending();
      } catch (e) {
        console.warn('Não foi possível checar estado da rede:', e);
      }
    })();

    return () => unsubscribe();
  }, []);

  // Função para enviar os dados para o Supabase
  const handleSubmit = async () => {
    // Validação dos campos
    if (!profName.trim()) {
      Alert.alert('Erro', 'Por favor, insira o nome do avaliador.');
      return;
    }
    if (!turma) {
      Alert.alert('Erro', 'Por favor, selecione a turma.');
      return;
    }
    if (!groupName.trim()) {
      Alert.alert('Erro', 'Por favor, insira o nome do grupo.');
      return;
    }
    if (Object.keys(scores).length < CRITERIA.length) {
      Alert.alert('Erro', 'Por favor, avalie todos os 5 critérios.');
      return;
    }
    // Alerta de confirmação
    Alert.alert(
      'Confirmar Envio',
      `Você está prestes a enviar a avaliação para o grupo "${groupName}" com nota final ${totalScore.toFixed(2)}. Deseja continuar?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: async () => {
            setIsLoading(true);
            // Validação extra: certificar que cada nota está dentro dos valores permitidos
            const allowedValues = OPTIONS.map(o => o.value);
            for (const c of CRITERIA) {
              const v = scores[c.id];
              if (typeof v !== 'number' || !allowedValues.includes(v)) {
                setIsLoading(false);
                Alert.alert('Erro', `Nota inválida para: ${c.text}`);
                return;
              }
            }
            // Monta o objeto que será salvo no banco (mapeando para a tabela 'avaliacoes')
            const evaluationData = {
              grupo: groupName.trim(),
              turma: turma.trim(),
              avaliador: profName.trim(),
              criterio1: Number((scores['c1'] ?? 0).toFixed(2)),
              criterio2: Number((scores['c2'] ?? 0).toFixed(2)),
              criterio3: Number((scores['c3'] ?? 0).toFixed(2)),
              criterio4: Number((scores['c4'] ?? 0).toFixed(2)),
              criterio5: Number((scores['c5'] ?? 0).toFixed(2)),             
              total: Number(totalScore.toFixed(2)),
              obs: obs.trim() || null,
            };
            // Se não estiver conectado, salva localmente e retorna
            if (!isConnected) {
              await savePending(evaluationData);
              setIsLoading(false);
              Alert.alert('Offline', 'Sem conexão. Avaliação salva localmente e será sincronizada quando houver rede.', [
                { text: 'OK', onPress: resetForm }
              ]);
              return;
            }
            // Tenta inserir os dados na tabela 'avaliacoes' do Supabase
            try {
              const { data, error } = await supabase
                .from('avaliacoes_pi_2025')
                .insert([evaluationData]);
              setIsLoading(false);
              if (error) {
                console.error('Erro ao salvar avaliação:', error);
                // Possível problema de rede/servidor: salva localmente como fallback
                await savePending(evaluationData);
                Alert.alert('Salvo localmente', 'Não foi possível enviar para o servidor agora. A avaliação foi salva localmente e será sincronizada automaticamente.', [
                  { text: 'OK', onPress: resetForm }
                ]);
                return;
              }
              console.log('Avaliação salva:', data);
              Alert.alert('Sucesso!', 'Avaliação enviada com sucesso.', [
                { text: 'OK', onPress: resetForm }
              ]);
            } catch (ex) {
              setIsLoading(false);
              console.error('Exceção ao salvar avaliação:', ex);
              // Salvar localmente como fallback
              await savePending(evaluationData);
              Alert.alert('Salvo localmente', 'Erro ao enviar. A avaliação foi salva localmente e será sincronizada quando possível.');
            }
        }},
      ]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Avaliação Projeto Integador 2025</Text>
      </View>
      
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Campo para o nome do grupo */}
        <View style={styles.card}>
            <Text style={styles.cardTitle}>Avaliador</Text>
            <TextInput
                style={styles.input}
                placeholder="Digite o nome do avaliador"
                placeholderTextColor="#999"
                value={profName}
                onChangeText={setProfName}
            />
        </View>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Turma</Text>
          <Picker
            selectedValue={turma}
            style={styles.picker}
            onValueChange={(itemValue) => setTurma(itemValue)}
          >
            <Picker.Item label="Selecione..." value="" />
            <Picker.Item label="1 e 2 Ano" value="1e2" />
            <Picker.Item label="3 Ano" value="3" />
          </Picker>
        </View>
         <View style={styles.card}>
            <Text style={styles.cardTitle}>Grupo</Text>
            <TextInput
                style={styles.input}
                placeholder="Digite o nome do grupo avaliado"
                placeholderTextColor="#999"
                value={groupName}
                onChangeText={setGroupName}
            />
        </View>

        {/* Lista de critérios */}
        {CRITERIA.map((criterion, index) => (
          <View key={criterion.id} style={styles.card}>
            <Text style={styles.cardTitle}>{index + 1}. {criterion.text}</Text>
            <Text style={styles.cardDescription}>{criterion.description}</Text>
            <View style={styles.optionsContainer}>
              {OPTIONS.map(option => (
                <TouchableOpacity
                  key={option.label}
                  style={[
                    styles.optionButton,
                    scores[criterion.id] === option.value && styles.optionButtonSelected
                  ]}
                  onPress={() => handleSelectScore(criterion.id, option.value)}
                >
                  <Text style={[
                      styles.optionButtonText,
                      scores[criterion.id] === option.value && styles.optionButtonTextSelected
                  ]}>
                    {option.label} ({option.value.toFixed(2)})
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}

           <View style={styles.card}>
            <Text style={styles.cardTitle}>Observação</Text>
            <TextInput
                style={styles.input}
                placeholder="Observação do grupo avaliado"
                placeholderTextColor="#999"
                value={obs}
                onChangeText={setObs}
            />
        </View>
      </ScrollView>
      

      {/* Rodapé com a nota final e o botão de envio */}
      <View style={styles.footer}>
        <View style={styles.totalScoreContainer}>
            <Text style={styles.totalScoreLabel}>Nota Final:</Text>
            <Text style={styles.totalScoreValue}>{totalScore.toFixed(2)}</Text>
        </View>
        <TouchableOpacity 
            style={[styles.submitButton, isLoading && styles.submitButtonDisabled]} 
            onPress={handleSubmit}
            disabled={isLoading}
        >
            {isLoading ? (
                <ActivityIndicator color="#fff" />
            ) : (
                <Text style={styles.submitButtonText}>Enviar Avaliação</Text>
            )}
        </TouchableOpacity>
      </View>

    
    </SafeAreaView>
  );
}

// --- ESTILOS DO APLICATIVO ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#004A8D',
  },
  header: {
    backgroundColor: '#FDC180',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0F0F0f',
    textAlign: 'center',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 120, // Espaço para o rodapé fixo
  },
  card: {
    backgroundColor: '#FDC180',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2d2d2d'
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#0F0f0f',
    marginBottom: 4,
  },
  cardDescription: {
    fontSize: 14,
    color: '#2d2d2d',
    marginBottom: 16,
    fontStyle: 'italic',
  },
  input: {
    backgroundColor: '#FFFFFF',
    color: '#252525',
    padding: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#444',
    borderRadius: 10,
  },
  picker: {
    backgroundColor: '#FFFFFF',
    color: '#252525',    
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#444',    
  },
  optionsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',  
  },
  optionButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#F7941D',
    marginHorizontal: 4,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#FFF'
  },
  optionButtonSelected: {
    backgroundColor: '#228630',
    borderColor: '#228630',
  },
  optionButtonText: {
    color: '#FFF',
    fontWeight: '500',
  },
  optionButtonTextSelected: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FDC180',
    padding: 16,
    paddingBottom: 64,
    borderTopWidth: 1,
    borderTopColor: '#333',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalScoreContainer:{
    alignItems: 'flex-start',
  },
  totalScoreLabel:{
    color: '#0f0f0f',
    fontSize: 14,
  },
  totalScoreValue:{
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: 'bold',
  },
  submitButton: {
    backgroundColor: '#F7941D',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#555',
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

