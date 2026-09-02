import { useState, useEffect, useCallback, useRef } from 'react';
import { useSelector } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import {
  Layers, Plus, Trash2, ExternalLink, ChevronDown, ChevronUp,
  Loader, RefreshCw, AlertTriangle, Rocket, Upload, X, Eye,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { listBatches, getBatch, createBatch } from '../services/batches';
import { listStagedItems, launchStagedItems, ignoreStagedItem, syncGoogleSheetNow } from '../services/gsheetStaging';
import { parseBatchSheetRows } from '../utils/batchSheetImport';
import { fmtDate, fmtDuration, fmtCost, BATCH_STATUS_META, ITEM_STATUS_META } from '../utils/batchDisplay';
import Badge from '../components/common/Badge';

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Deux listes non bornées (lignes détectées, historique des lots) rendues
// entièrement à plat -- pagine juste l'AFFICHAGE, sans changer ce que
// "Tout sélectionner" ou le rafraîchissement chargent.
const PAGE_SIZE = 8;

function Pager({ page, totalPages, onChange }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-3 pt-1 text-sm">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page === 0}
        className="px-2 py-1 rounded-md border border-gray-200 text-gray-600 disabled:opacity-30 hover:bg-gray-50"
      >
        ‹ Précédent
      </button>
      <span className="text-gray-400">Page {page + 1} / {totalPages}</span>
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages - 1}
        className="px-2 py-1 rounded-md border border-gray-200 text-gray-600 disabled:opacity-30 hover:bg-gray-50"
      >
        Suivant ›
      </button>
    </div>
  );
}

const MAJ_TYPES = [
  { value: 'maj',     label: 'MAJ ciblée' },
  { value: 'refonte', label: 'Refonte' },
];

const newRow = () => ({ id: uid(), articleUrl: '', targetKeyword: '', majType: 'maj', consigne: '' });

// Meilleur effort, purement informatif (affichage) -- jamais bloquant si l'URL
// est mal formée, le champ `site` de la table reste facultatif.
const guessSite = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }
};

const isLikelyUrl = (v) => /^https?:\/\/.+/i.test((v || '').trim());

// Confirmation dédiée au lancement -- ConfirmDialog (src/components/common) est
// câblé pour la suppression (icône corbeille, thème rouge) : le réutiliser ici
// afficherait "Supprimer" en rouge sur une action qui n'a rien de destructeur.
function LaunchConfirmDialog({ count, username, onConfirm, onCancel }) {
  return createPortal(
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 700 }}
      className="bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-6"
      onMouseDown={onCancel}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.35)] w-full max-w-sm p-6 text-center border-t-4 border-teal-500"
      >
        <div className="mx-auto w-11 h-11 rounded-2xl flex items-center justify-center mb-3 bg-teal-50">
          <Rocket size={19} className="text-teal-600" />
        </div>
        <h3 className="text-[15px] font-bold text-gray-900">Lancer ce lot ?</h3>
        <p className="text-[13px] text-gray-500 mt-2 leading-relaxed">
          {count} article{count > 1 ? 's' : ''} vont être enregistrés en attente de traitement.
          {username ? ` Ce lot sera attribué à ${username}.` : ''}
        </p>
        <div className="flex items-center justify-center gap-3 mt-5">
          <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors">
            Annuler
          </button>
          <button type="button" onClick={onConfirm} className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 transition-colors shadow-sm">
            Lancer
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default function LotsBatch() {
  const authUsername = useSelector(s => s.auth.username);

  const [rows, setRows] = useState(() => [newRow()]);
  const [commonConsigne, setCommonConsigne] = useState('');
  const [bulkPaste, setBulkPaste] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirmLaunch, setConfirmLaunch] = useState(false);

  const [batches, setBatches] = useState([]);
  const [loadingBatches, setLoadingBatches] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [itemsByBatch, setItemsByBatch] = useState({});
  const [loadingItemsId, setLoadingItemsId] = useState(null);
  const fileInputRef = useRef(null);

  // Lignes détectées automatiquement sur le Google Sheet (cron 5 min côté
  // serveur, voir src/server/googleSheetSync.js) -- jamais lancées seules,
  // juste mises en attente ici jusqu'à un clic humain sur "Lancer".
  const [stagedItems, setStagedItems] = useState([]);
  const [loadingStaged, setLoadingStaged] = useState(true);
  const [syncingSheet, setSyncingSheet] = useState(false);
  const [selectedStagedIds, setSelectedStagedIds] = useState(() => new Set());
  const [launchingStaged, setLaunchingStaged] = useState(false);
  const [stagedPage, setStagedPage] = useState(0);
  const [batchPage, setBatchPage] = useState(0);
  const [relaunchingId, setRelaunchingId] = useState(null);
  const [expandedErrorIds, setExpandedErrorIds] = useState(() => new Set());

  const refreshBatches = useCallback(async () => {
    setLoadingBatches(true);
    try {
      const list = await listBatches(20);
      setBatches(list);
    } catch (e) {
      toast.error(`Impossible de charger l'historique des lots : ${e.message}`);
    } finally {
      setLoadingBatches(false);
    }
  }, []);

  const refreshStaged = useCallback(async () => {
    setLoadingStaged(true);
    try {
      const list = await listStagedItems();
      setStagedItems(list);
      setSelectedStagedIds((prev) => new Set([...prev].filter((id) => list.some((it) => it.id === id))));
    } catch (e) {
      toast.error(`Impossible de charger les lignes détectées : ${e.message}`);
    } finally {
      setLoadingStaged(false);
    }
  }, []);

  useEffect(() => { refreshBatches(); }, [refreshBatches]);
  useEffect(() => { refreshStaged(); }, [refreshStaged]);

  const toggleStagedSelect = (id) => setSelectedStagedIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleSelectAllStaged = () => setSelectedStagedIds((prev) => (
    prev.size === stagedItems.length ? new Set() : new Set(stagedItems.map((it) => it.id))
  ));

  const handleSync = async () => {
    setSyncingSheet(true);
    try {
      const result = await syncGoogleSheetNow();
      // Détail complet plutôt que le seul "inserted" -- sans lui, une ligne
      // ignorée (sans "N°"/URL/mot-clé, ou déjà connue) était indiscernable
      // d'un vrai souci de lecture du Sheet : le compte affiché ne bougeait
      // pas dans les deux cas, sans jamais dire pourquoi.
      const skipMsgs = [];
      if (result.skippedNoRowRef) skipMsgs.push(`${result.skippedNoRowRef} sans "N°"`);
      if (result.skippedNoUrl) skipMsgs.push(`${result.skippedNoUrl} sans URL`);
      if (result.skippedNoKeyword) skipMsgs.push(`${result.skippedNoKeyword} sans mot-clé`);
      // "N°" déjà connu mais URL différente -- très probablement une ligne
      // dupliquée en modèle dans le Sheet dont le "N°" n'a pas été changé :
      // sans ce message, une ligne dans ce cas restait invisible pour toujours,
      // et "aucune ligne neuve" ne distinguait pas ce cas d'un Sheet vraiment
      // à jour.
      if (result.duplicateRowRef) skipMsgs.push(`${result.duplicateRowRef} avec un "N°" déjà utilisé par une autre ligne`);
      const base = result.inserted > 0
        ? `${result.inserted} nouvelle(s) ligne(s) détectée(s)`
        : 'Synchronisé -- aucune ligne neuve';
      const detail = ` (${result.scanned} ligne(s) valide(s) lue(s) sur le Sheet${skipMsgs.length ? `, ${skipMsgs.join(', ')} ignorée(s)` : ''})`;
      toast.success(base + detail + '.', { duration: skipMsgs.length ? 8000 : 4000 });
      await refreshStaged();
    } catch (e) {
      toast.error(`Synchronisation impossible : ${e.message}`);
    } finally {
      setSyncingSheet(false);
    }
  };

  const handleIgnoreStaged = async (id) => {
    try {
      await ignoreStagedItem(id);
      setStagedItems((items) => items.filter((it) => it.id !== id));
      setSelectedStagedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    } catch (e) {
      toast.error(`Impossible d'ignorer cette ligne : ${e.message}`);
    }
  };

  const handleLaunchStaged = async () => {
    setLaunchingStaged(true);
    try {
      const ids = [...selectedStagedIds];
      const { launchedCount, batchId } = await launchStagedItems(ids);
      toast.success(`Lot lancé -- ${launchedCount} article(s) enregistré(s).`);
      setSelectedStagedIds(new Set());
      await refreshStaged();
      await refreshBatches();
      setExpandedId(batchId);
      loadItems(batchId);
    } catch (e) {
      toast.error(`Échec du lancement : ${e.message}`);
    } finally {
      setLaunchingStaged(false);
    }
  };

  const updateRow = (id, patch) => setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (id) => setRows(rs => (rs.length > 1 ? rs.filter(r => r.id !== id) : rs));
  const addRow = () => setRows(rs => [...rs, newRow()]);

  // Import du fichier Sheet exporté par la rédac (voir batchSheetImport.js) --
  // les lignes arrivent dans le MÊME éditeur que la saisie manuelle, à relire
  // avant de lancer : aucun lancement automatique depuis un fichier importé.
  const handleImportFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permet de réimporter le même fichier après correction
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const sheetRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const { rows: parsed, skipped } = parseBatchSheetRows(sheetRows);

      const skipMsgs = [];
      if (skipped.notValidated) skipMsgs.push(`${skipped.notValidated} non validée(s)`);
      if (skipped.noUrl) skipMsgs.push(`${skipped.noUrl} sans URL`);
      if (skipped.noKeyword) skipMsgs.push(`${skipped.noKeyword} sans mot-clé`);

      if (!parsed.length) {
        toast.error(`Aucune ligne importable${skipMsgs.length ? ` (${skipMsgs.join(', ')})` : ' -- fichier vide ou format non reconnu'}.`);
        return;
      }
      setRows((rs) => {
        const existing = rs.filter((r) => r.articleUrl.trim());
        const added = parsed.map((p) => ({ id: uid(), ...p }));
        return [...existing, ...added];
      });
      toast.success(`${parsed.length} ligne(s) importée(s)${skipMsgs.length ? ` -- ${skipMsgs.join(', ')} ignorée(s)` : ''}.`);
    } catch (err) {
      toast.error(`Import impossible : ${err.message}`);
    }
  };

  // Une URL par ligne. Le type et la consigne se réglent après coup, ligne par
  // ligne -- la consigne commune ci-dessus ne fait que pré-remplir les lignes
  // vides, elle ne réécrit jamais une consigne déjà saisie.
  const applyBulkPaste = () => {
    const urls = bulkPaste.split('\n').map(l => l.trim()).filter(Boolean);
    if (!urls.length) return;
    setRows(rs => {
      const existing = rs.filter(r => r.articleUrl.trim());
      const added = urls.map(url => ({ id: uid(), articleUrl: url, targetKeyword: '', majType: 'maj', consigne: commonConsigne }));
      return [...existing, ...added];
    });
    setBulkPaste('');
  };

  const validRows = rows.filter(r => r.articleUrl.trim());
  const invalidUrlRows = validRows.filter(r => !isLikelyUrl(r.articleUrl));
  const missingKeywordRows = validRows.filter(r => !r.targetKeyword.trim());

  const handleLaunchClick = () => {
    if (!validRows.length) { toast.error('Ajoute au moins une URL avant de lancer le lot.'); return; }
    if (invalidUrlRows.length) { toast.error(`${invalidUrlRows.length} URL(s) ne commencent pas par http(s):// -- corrige-les avant de lancer.`); return; }
    if (missingKeywordRows.length) { toast.error(`${missingKeywordRows.length} ligne(s) sans mot-clé cible -- l'IA en a besoin pour traiter l'article.`); return; }
    setConfirmLaunch(true);
  };

  const doLaunch = async () => {
    setConfirmLaunch(false);
    setSubmitting(true);
    try {
      const items = validRows.map(r => ({
        site: guessSite(r.articleUrl) || undefined,
        articleUrl: r.articleUrl.trim(),
        targetKeyword: r.targetKeyword.trim(),
        majType: r.majType,
        consigne: r.consigne?.trim() || undefined,
      }));
      const { id } = await createBatch({ source: 'manual', items });
      toast.success(`Lot lancé -- ${items.length} article(s) enregistré(s).`);
      setRows([newRow()]);
      setCommonConsigne('');
      await refreshBatches();
      setExpandedId(id);
      loadItems(id);
    } catch (e) {
      toast.error(`Échec du lancement : ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // Relance UN item comme un nouveau lot d'un seul article -- ne touche jamais
  // la ligne d'origine (voir data-api.js, route PUT .../items/:itemId : "un
  // item ne se relance qu'en créant un nouveau batch"), pour ne jamais risquer
  // de heurter un ancien traitement encore en cours.
  const handleRelaunch = async (item) => {
    setRelaunchingId(item.id);
    try {
      const { id } = await createBatch({
        source: 'manual',
        items: [{
          site: item.site || undefined,
          articleUrl: item.articleUrl,
          targetKeyword: item.targetKeyword,
          majType: item.majType,
          consigne: item.consigne || undefined,
        }],
      });
      toast.success('Article relancé dans un nouveau lot.');
      await refreshBatches();
      setExpandedId(id);
      loadItems(id);
    } catch (e) {
      toast.error(`Échec de la relance : ${e.message}`);
    } finally {
      setRelaunchingId(null);
    }
  };

  const toggleErrorExpand = (itemId) => setExpandedErrorIds((prev) => {
    const next = new Set(prev);
    if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
    return next;
  });

  const loadItems = async (batchId) => {
    setLoadingItemsId(batchId);
    try {
      const full = await getBatch(batchId);
      setItemsByBatch(m => ({ ...m, [batchId]: full.items || [] }));
    } catch (e) {
      toast.error(`Impossible de charger le détail du lot : ${e.message}`);
    } finally {
      setLoadingItemsId(null);
    }
  };

  const toggleExpand = (batchId) => {
    if (expandedId === batchId) { setExpandedId(null); return; }
    setExpandedId(batchId);
    if (!itemsByBatch[batchId]) loadItems(batchId);
  };

  // Pagination d'affichage -- recalculée à chaque rendu (jamais stockée),
  // pour ne jamais rester bloqué sur une page vidée par un rafraîchissement,
  // un "Ignorer" ou un lancement.
  const stagedTotalPages = Math.max(1, Math.ceil(stagedItems.length / PAGE_SIZE));
  const stagedPageClamped = Math.min(stagedPage, stagedTotalPages - 1);
  const pagedStagedItems = stagedItems.slice(stagedPageClamped * PAGE_SIZE, (stagedPageClamped + 1) * PAGE_SIZE);

  const batchTotalPages = Math.max(1, Math.ceil(batches.length / PAGE_SIZE));
  const batchPageClamped = Math.min(batchPage, batchTotalPages - 1);
  const pagedBatches = batches.slice(batchPageClamped * PAGE_SIZE, (batchPageClamped + 1) * PAGE_SIZE);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <div className="flex items-center gap-3">
        <Layers className="w-6 h-6 text-teal-600" />
        <div>
          <h1 className="text-xl font-semibold text-gray-900">MAJ en lot</h1>
          <p className="text-sm text-gray-500">Lance plusieurs mises à jour d'un coup -- sans passer par le Google Sheet pour l'instant.</p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>
          Chaque article est traité automatiquement par l'IA (audit, génération, obsolescence, style) jusqu'à
          la relecture -- il n'est jamais publié tout seul. Vérifie et publie chaque article depuis l'écran habituel
          une fois son statut passé à « Fait ».
        </span>
      </div>

      {/* ── Nouveau lot ─────────────────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-gray-900">Nouveau lot</h2>
          <div>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImportFile} />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-gray-300 hover:bg-gray-50 text-sm font-medium text-gray-700 px-3 py-1.5"
            >
              <Upload className="w-4 h-4" /> Importer un Sheet (.xlsx)
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 -mt-2">
          Fichier exporté du Google Sheet de suivi -- seules les lignes avec la colonne « Validation » remplie sont importées.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Coller une liste d'URLs (une par ligne)</label>
            <textarea
              value={bulkPaste}
              onChange={e => setBulkPaste(e.target.value)}
              rows={3}
              placeholder="https://exemple.com/article-1&#10;https://exemple.com/article-2"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Consigne commune (pré-remplit les nouvelles lignes, modifiable ensuite)</label>
            <textarea
              value={commonConsigne}
              onChange={e => setCommonConsigne(e.target.value)}
              rows={3}
              placeholder="Ex : mettre à jour les chiffres 2026, ajouter un H2 sur..."
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={applyBulkPaste}
          disabled={!bulkPaste.trim()}
          className="text-sm font-medium text-teal-700 hover:text-teal-800 disabled:text-gray-300"
        >
          + Ajouter ces URLs aux lignes ci-dessous
        </button>

        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-col md:flex-row gap-2 items-start md:items-center border border-gray-100 rounded-lg p-2">
              <input
                type="text"
                value={r.articleUrl}
                onChange={e => updateRow(r.id, { articleUrl: e.target.value })}
                placeholder="https://..."
                className={`flex-1 min-w-0 rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 ${
                  r.articleUrl && !isLikelyUrl(r.articleUrl) ? 'border-red-300' : 'border-gray-300'
                }`}
              />
              <input
                type="text"
                value={r.targetKeyword}
                onChange={e => updateRow(r.id, { targetKeyword: e.target.value })}
                placeholder="Mot-clé cible"
                title="Mot-clé cible -- obligatoire, l'IA en a besoin pour l'audit et la génération"
                className={`w-40 flex-shrink-0 rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 ${
                  r.articleUrl.trim() && !r.targetKeyword.trim() ? 'border-red-300' : 'border-gray-300'
                }`}
              />
              <select
                value={r.majType}
                onChange={e => updateRow(r.id, { majType: e.target.value })}
                className="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {MAJ_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              <input
                type="text"
                value={r.consigne}
                onChange={e => updateRow(r.id, { consigne: e.target.value })}
                placeholder="Consigne (optionnel)"
                className="flex-1 min-w-0 rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
              <button type="button" onClick={() => removeRow(r.id)} className="text-gray-400 hover:text-red-500 p-1.5" title="Retirer la ligne">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2">
          <button type="button" onClick={addRow} className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">
            <Plus className="w-4 h-4" /> Ajouter une ligne
          </button>
          <button
            type="button"
            onClick={handleLaunchClick}
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white text-sm font-medium px-4 py-2"
          >
            {submitting ? <Loader className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
            Lancer le lot ({validRows.length} article{validRows.length > 1 ? 's' : ''})
          </button>
        </div>
      </section>

      {/* ── Lignes détectées automatiquement depuis le Google Sheet ────────── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="font-medium text-gray-900">Lignes détectées depuis le Google Sheet</h2>
            {stagedItems.length > 0 && (
              <span className="text-xs font-semibold text-white bg-teal-600 rounded-full px-2 py-0.5">{stagedItems.length}</span>
            )}
          </div>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncingSheet}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 text-sm font-medium text-gray-700 px-3 py-1.5"
          >
            <RefreshCw className={`w-4 h-4 ${syncingSheet ? 'animate-spin' : ''}`} /> Synchroniser maintenant
          </button>
        </div>
        <p className="text-xs text-gray-500 -mt-2">
          Détection automatique toutes les 5 minutes -- une ligne neuve du Sheet apparaît ici, à relire avant de la lancer.
          Rien n'est jamais lancé automatiquement.
        </p>

        {loadingStaged && !stagedItems.length && (
          <p className="text-sm text-gray-400 py-6 text-center">Chargement...</p>
        )}
        {!loadingStaged && !stagedItems.length && (
          <p className="text-sm text-gray-400 py-6 text-center">Aucune ligne neuve détectée pour l'instant.</p>
        )}

        {stagedItems.length > 0 && (
          <>
            <div className="space-y-2">
              {pagedStagedItems.map((it) => (
                <div key={it.id} className="flex flex-col md:flex-row gap-2 items-start md:items-center border border-gray-100 rounded-lg p-2">
                  <input
                    type="checkbox"
                    checked={selectedStagedIds.has(it.id)}
                    onChange={() => toggleStagedSelect(it.id)}
                    className="w-4 h-4 flex-shrink-0 mt-1 md:mt-0"
                  />
                  <div className="flex-1 min-w-0">
                    <a
                      href={it.articleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-gray-900 font-medium hover:underline inline-flex items-center gap-1 max-w-full truncate"
                    >
                      <span className="truncate">{it.articleUrl}</span>
                      <ExternalLink className="w-3 h-3 flex-shrink-0 text-gray-400" />
                    </a>
                    <div className="text-xs text-gray-500">
                      {it.targetKeyword || '—'} · {MAJ_TYPES.find((t) => t.value === it.majType)?.label || it.majType || '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleIgnoreStaged(it.id)}
                    className="text-gray-400 hover:text-red-500 p-1.5"
                    title="Ignorer cette ligne"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <Pager page={stagedPageClamped} totalPages={stagedTotalPages} onChange={setStagedPage} />
            <div className="flex items-center justify-between pt-2">
              <button type="button" onClick={toggleSelectAllStaged} className="text-sm font-medium text-gray-600 hover:text-gray-900">
                {selectedStagedIds.size === stagedItems.length ? 'Tout désélectionner' : 'Tout sélectionner'}
              </button>
              <button
                type="button"
                onClick={handleLaunchStaged}
                disabled={!selectedStagedIds.size || launchingStaged}
                className="inline-flex items-center gap-2 rounded-lg bg-teal-600 hover:bg-teal-700 disabled:bg-teal-300 text-white text-sm font-medium px-4 py-2"
              >
                {launchingStaged ? <Loader className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                Lancer la sélection ({selectedStagedIds.size})
              </button>
            </div>
          </>
        )}
      </section>

      {/* ── Historique ──────────────────────────────────────────────────── */}
      <section className="bg-white border border-gray-200 rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-gray-900">Historique des lots</h2>
          <button type="button" onClick={refreshBatches} className="text-gray-400 hover:text-gray-700 p-1.5" title="Rafraîchir">
            <RefreshCw className={`w-4 h-4 ${loadingBatches ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loadingBatches && !batches.length && (
          <p className="text-sm text-gray-400 py-6 text-center">Chargement...</p>
        )}
        {!loadingBatches && !batches.length && (
          <p className="text-sm text-gray-400 py-6 text-center">Aucun lot lancé pour l'instant.</p>
        )}

        <div className="divide-y divide-gray-100">
          {pagedBatches.map((b) => (
            <div key={b.id}>
              <button
                type="button"
                onClick={() => toggleExpand(b.id)}
                className="w-full flex items-center gap-4 py-3 text-left hover:bg-gray-50 px-2 rounded-lg"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">{fmtDate(b.launchedAt)}</div>
                  <div className="text-xs text-gray-500">Lancé par {b.launchedByName || b.launchedBy || '—'}</div>
                </div>
                <Badge meta={BATCH_STATUS_META[b.status]} fallback={b.status} />
                <div className="text-xs text-gray-500 w-36 text-right">
                  <div>
                    {b.completedCount || 0}/{b.rowCount} terminés
                    {b.errorCount ? <span className="text-red-500"> · {b.errorCount} erreur(s)</span> : null}
                  </div>
                  {(b.totalCostUsd != null || b.totalDurationMs != null) && (
                    <div className="text-gray-400">{fmtCost(b.totalCostUsd)} · {fmtDuration(b.totalDurationMs)}</div>
                  )}
                </div>
                {expandedId === b.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>

              <AnimatePresence>
                {expandedId === b.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-2 pb-4">
                      {loadingItemsId === b.id && <p className="text-sm text-gray-400 py-3">Chargement des articles...</p>}
                      {itemsByBatch[b.id] && (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-xs text-gray-400 border-b border-gray-100">
                              <th className="text-left font-medium py-1.5">Article</th>
                              <th className="text-left font-medium py-1.5">Mot-clé</th>
                              <th className="text-left font-medium py-1.5">Type</th>
                              <th className="text-left font-medium py-1.5">Consigne</th>
                              <th className="text-left font-medium py-1.5">Durée</th>
                              <th className="text-left font-medium py-1.5">Coût</th>
                              <th className="text-left font-medium py-1.5">Statut</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {itemsByBatch[b.id].map(it => (
                              <tr key={it.id}>
                                <td className="py-1.5 pr-2 max-w-xs truncate">
                                  <a href={it.articleUrl} target="_blank" rel="noopener noreferrer" className="text-teal-700 hover:underline inline-flex items-center gap-1">
                                    <span className="truncate">{it.articleUrl}</span>
                                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                                  </a>
                                </td>
                                <td className="py-1.5 pr-2 text-gray-600">{it.targetKeyword || '—'}</td>
                                <td className="py-1.5 pr-2">{MAJ_TYPES.find(t => t.value === it.majType)?.label || it.majType || '—'}</td>
                                <td className="py-1.5 pr-2 max-w-xs truncate text-gray-500" title={it.consigne || ''}>{it.consigne || '—'}</td>
                                <td className="py-1.5 pr-2 text-gray-500 whitespace-nowrap">
                                  {it.startedAt && it.completedAt ? fmtDuration(it.completedAt - it.startedAt) : '—'}
                                </td>
                                <td className="py-1.5 pr-2 text-gray-500 whitespace-nowrap">{fmtCost(it.costUsd)}</td>
                                <td className="py-1.5">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Badge meta={ITEM_STATUS_META[it.status]} fallback={it.status} />
                                    {it.status === 'fait' && it.articleId && (
                                      <Link
                                        to={`/?articleId=${encodeURIComponent(it.articleId)}`}
                                        className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800 hover:underline"
                                        title="Ouvrir cet article en relecture"
                                      >
                                        <Eye className="w-3.5 h-3.5" /> Relire
                                      </Link>
                                    )}
                                    {(it.status === 'erreur' || it.status === 'a_revoir') && (
                                      <button
                                        type="button"
                                        onClick={() => handleRelaunch(it)}
                                        disabled={relaunchingId === it.id}
                                        className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-800 hover:underline disabled:opacity-50"
                                        title="Relance cet article dans un nouveau lot d'un seul article -- sans toucher à celui-ci"
                                      >
                                        {relaunchingId === it.id
                                          ? <Loader className="w-3.5 h-3.5 animate-spin" />
                                          : <RefreshCw className="w-3.5 h-3.5" />}
                                        Relancer
                                      </button>
                                    )}
                                    {it.errorMessage && (
                                      <button
                                        type="button"
                                        onClick={() => toggleErrorExpand(it.id)}
                                        className="text-xs font-medium text-red-500 hover:text-red-600 underline decoration-dotted"
                                      >
                                        {expandedErrorIds.has(it.id) ? 'Masquer l\'erreur' : 'Voir l\'erreur'}
                                      </button>
                                    )}
                                  </div>
                                  {it.errorMessage && expandedErrorIds.has(it.id) && (
                                    <pre className="mt-1.5 text-xs text-red-600 bg-red-50 border border-red-100 rounded-md p-2 whitespace-pre-wrap break-words max-w-md">
                                      {it.errorMessage}
                                    </pre>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
        <Pager page={batchPageClamped} totalPages={batchTotalPages} onChange={setBatchPage} />
      </section>

      {confirmLaunch && (
        <LaunchConfirmDialog
          count={validRows.length}
          username={authUsername}
          onConfirm={doLaunch}
          onCancel={() => setConfirmLaunch(false)}
        />
      )}
    </div>
  );
}
