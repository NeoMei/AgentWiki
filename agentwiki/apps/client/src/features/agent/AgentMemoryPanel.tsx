import React, { useCallback, useEffect, useState } from 'react';
import { Archive, Brain, Plus, Search, Trash2 } from 'lucide-react';
import api from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';

export const AgentMemoryPanel: React.FC<{ agentId: string; grants: any[]; enabled: boolean; onEnabled: () => Promise<void> }> = ({ agentId, grants, enabled, onEnabled }) => {
  const { language } = useLanguage();
  const zh = language === 'zh-CN';
  const [spaceId, setSpaceId] = useState(grants[0]?.spaceId || '');
  const [memories, setMemories] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [type, setType] = useState('episodic');
  const [visibility, setVisibility] = useState<'private' | 'space'>('private');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (enabled && spaceId) setMemories((await api.get('/agents/' + agentId + '/memories?spaceId=' + spaceId)).data);
  }, [agentId, enabled, spaceId]);
  useEffect(() => { void load(); }, [load]);

  if (!enabled) return (
    <div className="border rounded-[14px] bg-white p-8 text-center">
      <Brain size={30} className="mx-auto text-gray-300 mb-3" />
      <p className="font-medium">{zh ? '记忆尚未启用' : 'Memory is disabled'}</p>
      <p className="text-sm text-gray-500 mt-1 mb-4">{zh ? '请先为智能体分配知识空间，再启用记忆。' : 'Enable it only after assigning the Agent to a space.'}</p>
      <button disabled={!grants.length} onClick={() => void onEnabled()} className="h-8 px-3 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50">{zh ? '启用记忆' : 'Enable memory'}</button>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <select value={spaceId} onChange={(event) => setSpaceId(event.target.value)} className="h-8 border rounded-lg px-2 text-sm">{grants.map((grant) => <option key={grant.spaceId} value={grant.spaceId}>{grant.space.name}</option>)}</select>
        <input value={query} onChange={(event) => setQuery(event.target.value)} className="h-8 flex-1 border rounded-lg px-3 text-sm" placeholder={zh ? '召回相关记忆' : 'Recall relevant memory'} />
        <button onClick={async () => { try { setError(null); const response = await api.post('/agents/' + agentId + '/memories/recall', { spaceId, query }); setResults(response.data); } catch (e: any) { setError(e.response?.data?.message || 'Failed'); } }} className="h-8 px-3 border rounded-lg text-sm flex items-center gap-1"><Search size={14} /> {zh ? '召回' : 'Recall'}</button>
      </div>
      {results ? <div className="border rounded-[14px] bg-blue-50/40 p-4"><p className="text-sm font-medium mb-2">{zh ? '召回结果' : 'Recall results'}</p>{results.map((result) => <div key={result.memory.id} className="text-sm py-2 border-t first:border-0">{result.memory.content}<span className="text-xs text-gray-400 ml-2">score {result.score.toFixed(2)} · lexical {result.reasons.lexical.toFixed(2)} · vector {result.reasons.vector.toFixed(2)} · graph {result.reasons.graph.toFixed(2)}</span></div>)}</div> : null}
      {error ? <div className="p-3 mb-4 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div> : null}
      <form onSubmit={async (event) => { event.preventDefault(); try { setError(null); await api.post('/agents/' + agentId + '/memories', { spaceId, type, content, visibility }); setContent(''); await load(); } catch (e: any) { setError(e.response?.data?.message || 'Failed'); } }} className="border rounded-[14px] bg-white p-4">
        <div className="flex flex-wrap gap-2">
          <select value={type} onChange={(event) => setType(event.target.value)} className="h-8 border rounded-lg px-2 text-sm"><option value="episodic">{zh ? '情景记忆' : 'Episodic'}</option><option value="semantic">{zh ? '语义记忆' : 'Semantic'}</option></select>
          <select value={visibility} onChange={(event) => setVisibility(event.target.value as 'private' | 'space')} className="h-8 border rounded-lg px-2 text-sm" aria-label={zh ? '记忆可见性' : 'Memory visibility'}><option value="private">{zh ? '智能体私有' : 'Private to Agent'}</option><option value="space">{zh ? '空间内共享' : 'Shared in Space'}</option></select>
          <input value={content} onChange={(event) => setContent(event.target.value)} className="h-8 flex-1 min-w-48 border rounded-lg px-3 text-sm" placeholder={zh ? '记忆内容' : 'Memory content'} required />
          <button className="h-8 px-3 bg-blue-600 text-white rounded-lg text-sm flex items-center gap-1"><Plus size={14} /> {zh ? '添加' : 'Add'}</button>
        </div>
      </form>
      <div className="border rounded-[14px] bg-white divide-y">
        {memories.map((memory) => <div key={memory.id} className="p-4 flex gap-3"><div className="flex-1"><p className="text-sm">{memory.content}</p><p className="text-xs text-gray-400 mt-1">{memory.type} · {memory.visibility === 'space' ? (zh ? '空间内共享' : 'shared in Space') : (zh ? '智能体私有' : 'private to Agent')} · {zh ? '重要度' : 'importance'} {memory.importance}</p></div><button onClick={async () => { try { setError(null); await api.post('/agents/' + agentId + '/memories/' + memory.id + '/archive', { spaceId }); await load(); } catch (e: any) { setError(e.response?.data?.message || 'Failed'); } }} className="text-gray-500" title={zh ? '归档' : 'Archive'}><Archive size={15} /></button><button onClick={async () => { try { setError(null); await api.delete('/agents/' + agentId + '/memories/' + memory.id + '?spaceId=' + spaceId); await load(); } catch (e: any) { setError(e.response?.data?.message || 'Failed'); } }} className="text-red-600" title={zh ? '删除' : 'Delete'}><Trash2 size={15} /></button></div>)}
        {!memories.length ? <div className="py-10 text-center text-sm text-gray-500">{zh ? '没有有效记忆。' : 'No active memories.'}</div> : null}
      </div>
    </div>
  );
};
