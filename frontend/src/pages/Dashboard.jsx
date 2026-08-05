import { Link } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { useI18n } from '../i18n.jsx';

export default function Dashboard() {
  const { t } = useI18n();
  const { isDirection, isFloor, canOrders } = useAuth();

  const tiles = [];
  if (isFloor) {
    tiles.push(['/sales', t('nav.sales'), 'Saisir les quantités vendues par produit.']);
    tiles.push(['/stock', t('nav.stock'), 'Comptage à l\'aveugle de tout le stock (aliments + emballages).']);
    tiles.push(['/pertes', t('nav.pertes'), 'Déclarer les pertes : ingrédient ou produit + quantité + raison.']);
    tiles.push(['/emballage', t('nav.emballage'), 'Commander les emballages (indice basé sur l\'historique).']);
    tiles.push(['/pertes-view', t('nav.pertesView'), 'Voir les pertes déclarées.']);
  }
  if (canOrders) {
    tiles.push(['/orders', t('nav.orders'), 'Commande auto-générée (aliments) à vérifier puis confirmer envoyée ; emballages manuels.']);
  }
  const dirTiles = [
    ['/waste', t('nav.waste'), 'Gaspillage et écarts par article (Direction uniquement).'],
    ['/initial-stock', t('nav.initialstock'), 'Définir le stock initial d\'un restaurant (une seule fois).'],
    ['/items', t('nav.items'), 'Gérer les articles, unités, tailles de paquet.'],
    ['/recipes', t('nav.recipes'), 'Modifier les recettes (versionnées).'],
    ['/buffers', t('nav.buffers'), 'Régler les marges de sécurité par article.'],
    ['/users', t('nav.users'), 'Créer les comptes managers L1/L2, rôles, réinitialiser les mots de passe.'],
    ['/audit', t('nav.audit'), 'Journal de toutes les modifications.'],
  ];
  const all = isDirection ? [...tiles, ...dirTiles] : tiles;

  return (
    <>
      <div className="topbar">
        <h1>{t('nav.dashboard')}</h1>
      </div>
      <p className="tagline">{t('app.tagline')}</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {all.map(([to, title, desc]) => (
          <Link key={to} to={to} className="card" style={{ textDecoration: 'none', color: 'inherit' }}>
            <h2 style={{ color: 'var(--green)' }}>{title}</h2>
            <p className="muted" style={{ margin: 0 }}>{desc}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
