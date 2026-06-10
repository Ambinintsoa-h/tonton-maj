# Système de tickets

## Statuts & flux
```
open → in_progress → testing → resolved → closed
  └──────────────────────────────────────→ closed (raccourci admin)
closed/resolved → open (réouverture)
```

## Colonnes Kanban
| Colonne | Statuts inclus |
|---------|---------------|
| Ouvert | `open` |
| En cours | `in_progress` |
| À tester | `testing` |
| Clôturé | `closed` + `resolved` |

## Niveaux
- **L1** : créé par `cq_ia`, assigné au premier `manager`
- **L2** : escaladé par `manager`/`support`, assigné au premier `super_admin`

## Permissions
### Création (`canCreate`)
`cq_ia`, `manager`, `support`, `super_admin`

### Suppression (`canDeleteTicket`)
| Rôle | Peut supprimer |
|------|---------------|
| `super_admin` | Tous |
| `manager` | Ses tickets + tickets dont `creatorRole === 'cq_ia'` |
| `cq_ia` | Ses tickets (`creatorId === uid` ou `creatorUsername === username`) |
| `support` | Aucun |

Règle miroir dans `firestore.rules` (allow delete) et `canDeleteTicket()` dans Tickets.jsx.

### Actions selon rôle
| Action | super_admin | manager | support | cq_ia |
|--------|------------|---------|---------|-------|
| Prendre en charge | ✓ | ✓ | ✓ | — |
| Escalader L2 | — | ✓ | ✓ | — |
| Marquer résolu | ✓ | ✓ | ✓ | — |
| Clôturer | ✓ | ✓ | ✓ | — |
| Confirmer résolu | — | — | — | ✓ (créateur) |
| Rouvrir | — | — | — | ✓ (créateur) |
| Assigner | ✓ | ✓ | ✓ | — |
| Changer priorité | ✓ | ✓ | ✓ | ✓ |

## UI — Composants clés (Tickets.jsx)
- `TicketCard` (vue liste) : trash inline dans flex-row titre, `opacity-0 group-hover:opacity-100`
- `KanbanCard` (vue kanban) : trash `absolute right-1.5 top-1.5 z-20` (recouvre GripVertical au survol)
- `TicketDetail` (drawer) : bouton Trash2 dans le header, avant le X
- `TicketDrawer` : panel slide depuis la droite, `z-[120]`
- Confirmation : toast custom (10s) avec boutons Supprimer/Annuler

## Firestore — Collection `tickets`
Champs importants : `creatorId`, `creatorUsername`, `creatorRole`, `assigneeId`, `assigneeUsername`, `status`, `priority`, `level`, `commentCount`, `attachments[]`

## Notifications auto
| Événement | Destinataire |
|-----------|-------------|
| Nouveau ticket | Manager(s) assigné(s) ou super_admin si L2 |
| Prise en charge | Créateur |
| Commentaire | Créateur + assigné + @mentionnés |
| Résolution | Créateur |
| Fermeture | Assigné |
| Réouverture | Assigné |
