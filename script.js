// --- Références aux éléments du DOM ---
const input = document.getElementById('ville-input'); // Champ de saisie de la ville
const list = document.getElementById('suggestions'); // Liste déroulante des suggestions
const second = document.getElementById('second-block'); // Bloc masqué (complément + CP)
const validMsg = document.getElementById('valid-msg'); // Message de confirmation verte
const errorMsg = document.getElementById('error-msg'); // Message d'erreur rouge

// --- Variables d'état ---
let selectedCity = null; // Nom de la ville validée (null si aucune sélection)
let activeIndex = -1; // Index de l'élément survolé au clavier (-1 = aucun)
let debounceTimer = null; // Référence au timer du debounce (pour pouvoir l'annuler)
let currentQuery = ''; // Dernière requête envoyée (évite les réponses en retard)

/**
 * highlight(str, q)
 * Entoure la partie de `str` qui correspond à la saisie `q` avec une balise <mark>,
 * afin de mettre en gras les caractères tapés dans la suggestion affichée.
 * Exemple : highlight("Quimper", "quim") → "‹mark›Quim‹/mark›per"
 */
function highlight(str, q) {
	const i = str.toLowerCase().indexOf(q.toLowerCase());
	if (i < 0) return str; // Pas de correspondance, on retourne le texte intact
	return str.slice(0, i) + '<mark>' + str.slice(i, i + q.length) + '</mark>' + str.slice(i + q.length);
}

/**
 * hideSuggestions()
 * Masque et vide complètement la liste déroulante des suggestions,
 * et remet l'index clavier à -1 (aucune ligne sélectionnée).
 */
function hideSuggestions() {
	list.style.display = 'none';
	list.innerHTML = '';
	activeIndex = -1;
}

/**
 * selectCity(nom, codesPostaux)
 * Valide la ville choisie par l'utilisateur (clic ou touche Entrée) :
 * - remplit le champ avec le nom officiel,
 * - affiche le message de confirmation,
 * - pré-remplit le code postal avec le premier de la liste,
 * - révèle le second bloc (complément + CP),
 * - déplace le focus sur le champ suivant.
 */
function selectCity(nom, codesPostaux) {
	input.value = nom;
	selectedCity = nom;
	hideSuggestions();
	input.classList.add('valid'); // Bordure verte
	validMsg.style.display = 'block';
	errorMsg.style.display = 'none';
	if (codesPostaux && codesPostaux.length > 0) {
		document.getElementById('cp-input').value = codesPostaux[0]; // Premier code postal
	}
	second.style.display = 'block';
	document.getElementById('rayon-input').focus();
}

/**
 * clearValid()
 * Réinitialise l'état de validation quand l'utilisateur retape dans le champ :
 * - efface la ville sélectionnée,
 * - retire la bordure verte,
 * - cache le message de confirmation et le second bloc,
 * - vide le code postal pré-rempli.
 */
function clearValid() {
	selectedCity = null;
	input.classList.remove('valid');
	validMsg.style.display = 'none';
	second.style.display = 'none';
	document.getElementById('cp-input').value = '';
}

/**
 * fetchCommunes(q)
 * Interroge l'API officielle geo.api.gouv.fr avec le texte saisi `q`.
 * - boost=population : les grandes villes remontent en premier dans les résultats.
 * - limit=8 : on affiche au maximum 8 suggestions.
 * Retourne une promesse qui résout vers un tableau d'objets commune.
 * Lance une erreur si la réponse HTTP n'est pas OK (ex : coupure réseau).
 */
async function fetchCommunes(q) {
	const url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(q)}&fields=nom,codesPostaux,codeDepartement&boost=population&limit=8`;
	const res = await fetch(url);
	if (!res.ok) throw new Error('Erreur API');
	return res.json();
}

/**
 * showLoading()
 * Affiche immédiatement un indicateur "Recherche…" dans la liste déroulante
 * pendant que la requête API est en cours, pour donner un retour visuel à l'utilisateur.
 */
function showLoading() {
	list.innerHTML = '<li class="loading">Recherche…</li>';
	list.style.display = 'block';
}

/**
 * renderResults(communes, q)
 * Construit et affiche la liste des suggestions à partir des résultats de l'API.
 * Pour chaque commune, crée un <li> contenant :
 * - le nom avec la saisie mise en évidence (highlight),
 * - le code postal et le numéro de département en gris.
 * Stocke le nom et les codes postaux en data-attributes pour les récupérer au clic.
 * Si aucun résultat, ferme la liste.
 */
function renderResults(communes, q) {
	if (!communes.length) { hideSuggestions(); return; }
	activeIndex = -1;
	list.innerHTML = '';
	communes.forEach(c => {
		const li = document.createElement('li');
		li.setAttribute('role', 'option');
		li.setAttribute('data-nom', c.nom);
		li.setAttribute('data-cp', JSON.stringify(c.codesPostaux || [])); // Stocké en JSON pour récupération au clic
		const cp = c.codesPostaux && c.codesPostaux[0] ? c.codesPostaux[0] : '';
		const dept = c.codeDepartement ? `(${c.codeDepartement})` : '';
		li.innerHTML = `<span>${highlight(c.nom, q)}</span><span class="dept">${cp} ${dept}</span>`;
		// mousedown plutôt que click : se déclenche avant le blur de l'input,
		// ce qui évite que la liste se ferme avant qu'on puisse enregistrer le clic.
		li.addEventListener('mousedown', e => {
			e.preventDefault();
			selectCity(c.nom, c.codesPostaux);
		});
		list.appendChild(li);
	});
	list.style.display = 'block';
}

/**
 * Événement : input (frappe dans le champ)
 * Déclenché à chaque modification du texte saisi.
 * - Réinitialise la validation précédente.
 * - Ignore les saisies de moins de 2 caractères.
 * - Met en place un debounce de 200 ms : si l'utilisateur continue à taper,
 *   le timer est annulé et relancé, évitant d'envoyer une requête par touche.
 * - Vérifie que la valeur n'a pas changé entre le lancement et la réponse
 *   (protection contre les réponses qui arrivent dans le désordre).
 */
input.addEventListener('input', () => {
	clearValid();
	errorMsg.style.display = 'none';
	const q = input.value.trim();
	clearTimeout(debounceTimer); // Annule la requête précédente non encore partie
	if (q.length < 2) { hideSuggestions(); return; }
	currentQuery = q;
	showLoading();
	debounceTimer = setTimeout(async () => {
		try {
			const communes = await fetchCommunes(q);
			// On n'affiche les résultats que si la valeur du champ n'a pas changé entre-temps
			if (input.value.trim() === currentQuery) renderResults(communes, q);
		} catch(e) {
			hideSuggestions(); // En cas d'erreur réseau, on ferme silencieusement
		}
	}, 200);
});

/**
 * Événement : keydown (navigation clavier dans la liste)
 * Gère la navigation dans les suggestions sans souris :
 * - ArrowDown / ArrowUp : déplace la sélection active dans la liste,
 *   scrolle automatiquement si nécessaire.
 * - Entrée : valide la suggestion actuellement active.
 * - Échap : ferme la liste sans rien sélectionner.
 * Les items avec la classe "loading" sont exclus de la navigation.
 */
input.addEventListener('keydown', e => {
	const items = list.querySelectorAll('li:not(.loading)');
	if (!items.length) return;
	if (e.key === 'ArrowDown') {
		e.preventDefault(); // Empêche le curseur de bouger dans l'input
		activeIndex = Math.min(activeIndex + 1, items.length - 1);
	} else if (e.key === 'ArrowUp') {
		e.preventDefault();
		activeIndex = Math.max(activeIndex - 1, 0);
	} else if (e.key === 'Enter') {
		e.preventDefault();
		if (activeIndex >= 0) {
			const li = items[activeIndex];
			selectCity(li.dataset.nom, JSON.parse(li.dataset.cp));
		}
		return;
	} else if (e.key === 'Escape') {
		hideSuggestions(); return;
	}
	// Met à jour la classe CSS "active" sur le bon élément
	items.forEach((li, i) => li.classList.toggle('active', i === activeIndex));
	// Fait défiler la liste pour garder l'élément actif visible
	if (activeIndex >= 0) items[activeIndex].scrollIntoView({ block: 'nearest' });
});

/**
 * Événement : blur (perte du focus sur le champ)
 * Déclenché quand l'utilisateur clique ailleurs ou appuie sur Tab.
 * Le setTimeout de 150 ms laisse le temps au mousedown d'une suggestion
 * de s'exécuter avant que la liste ne se ferme.
 * Si aucune ville valide n'est sélectionnée et que le champ n'est pas vide,
 * affiche le message d'erreur.
 */
input.addEventListener('blur', () => {
	setTimeout(() => {
		hideSuggestions();
		if (!selectedCity && input.value.trim()) {
			errorMsg.style.display = 'block';
		}
	}, 150);
});

/**
 * Événement : click sur le document
 * Ferme la liste déroulante si l'utilisateur clique en dehors
 * du champ de saisie et de la liste elle-même.
 */
document.addEventListener('click', e => {
	if (!list.contains(e.target) && e.target !== input) hideSuggestions();
});
