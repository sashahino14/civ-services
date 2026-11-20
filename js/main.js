// js/main.js

import { initMap, displayMarkers, clearMarkers, centerOnUser } from './modules/map.js';
import { CATEGORIES, DEFAULT_RADIUS } from './modules/categories/config.js';
import { fetchOverpass } from './modules/categories/overpass.js';
import { getAds, addAd, deleteAd } from './modules/storage.js'; // Nouvel import

let userPosition = null;
let lastSelectedCategory = null;

document.addEventListener('DOMContentLoaded', () => {
    
    const map = initMap();
    window.mapInstance = map; 

    createCategoryMenu();
    setupEmergencyModal();
    setupLostFoundModal(); // Nouvelle fonction
    setupNavigation();
    setupGeolocation();
    registerServiceWorker();
});

/**
 * Crée le menu des catégories
 */
function createCategoryMenu() {
    const container = document.getElementById('category-menu-container');
    const menu = document.createElement('div');
    menu.className = 'category-menu';
    
    Object.values(CATEGORIES).forEach(cat => {
        const btn = document.createElement('button');
        btn.className = 'category-btn';
        btn.dataset.category = cat.id;
        btn.innerHTML = `<i class="fas ${cat.icon}"></i> <span>${cat.name}</span>`;
        btn.style.borderLeft = `4px solid ${cat.color}`;
        
        btn.addEventListener('click', () => {
            document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            lastSelectedCategory = cat;
            searchServices(cat);
        });
        
        menu.appendChild(btn);
    });
    
    container.appendChild(menu);
}

/**
 * Lance la recherche des services
 */
async function searchServices(category) {
    const map = window.mapInstance;
    if (!map) return;

    const center = userPosition || map.getCenter();
    showLoading(true);

    try {
        const query = category.overpassQuery(center.lat, center.lng, DEFAULT_RADIUS);
        const services = await fetchOverpass(query);
        
        displayMarkers(map, services, category, (service) => {
            console.log('Marqueur cliqué :', service.name);
        });
        
        if (services.length === 0) {
            alert(`Aucun(e) ${category.name} trouvé(e) dans un rayon de ${DEFAULT_RADIUS / 1000} km.`);
        }
        
    } catch (error) {
        console.error('Erreur lors de la recherche :', error);
        alert('Erreur lors de la recherche. Vérifie ta connexion Internet.');
    } finally {
        showLoading(false);
    }
}

/**
 * Gère la modale et la logique des objets perdus/trouvés
 */
function setupLostFoundModal() {
    const navBtn = document.querySelector('.nav-item[data-screen="lost-found"]');
    const modal = document.getElementById('lost-found-modal');
    const closeBtn = document.getElementById('lost-found-close');
    const form = document.getElementById('lost-found-form');
    const listContainer = document.getElementById('lost-found-list');

    // Ouvrir la modale
    navBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
        modal.setAttribute('aria-hidden', 'false');
        renderAds(); // On met à jour la liste à l'ouverture
    });

    // Fermer la modale
    const closeModal = () => {
        modal.classList.add('hidden');
        modal.setAttribute('aria-hidden', 'true');
        // On remet le bouton "Accueil" actif visuellement
        document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
        document.querySelector('.nav-item[data-screen="home"]').classList.add('active');
    };

    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Soumission du formulaire
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const newAd = {
            title: document.getElementById('lf-title').value,
            desc: document.getElementById('lf-desc').value,
            location: document.getElementById('lf-location').value,
            contact: document.getElementById('lf-contact').value
        };

        addAd(newAd);
        form.reset(); // Vider le formulaire
        renderAds(); // Rafraîchir la liste
        alert('Annonce publiée avec succès !');
    });

    // Fonction pour afficher les annonces
    function renderAds() {
        const ads = getAds();
        listContainer.innerHTML = '';

        if (ads.length === 0) {
            listContainer.innerHTML = '<p style="text-align:center; color:#888; font-size:13px;">Aucune annonce pour le moment.</p>';
            return;
        }

        ads.forEach(ad => {
            const card = document.createElement('div');
            card.className = 'ad-card';
            card.innerHTML = `
                <div class="ad-title">${ad.title}</div>
                <div class="ad-desc">${ad.desc}</div>
                <div class="ad-info">
                    <span><i class="fas fa-map-marker-alt"></i> ${ad.location}</span>
                    <a href="tel:${ad.contact}" class="ad-contact"><i class="fas fa-phone"></i> Appeler</a>
                </div>
                <div style="font-size: 10px; color: #aaa; margin-top: 5px; text-align: right;">Publié le ${ad.date}</div>
            `;
            listContainer.appendChild(card);
        });
    }
}

/**
 * Gère la géolocalisation
 */
function setupGeolocation() {
    const locateBtn = document.getElementById('locate-btn');
    const map = window.mapInstance;

    locateBtn.addEventListener('click', () => {
        if (!navigator.geolocation) {
            alert("La géolocalisation n'est pas supportée par votre navigateur.");
            return;
        }

        locateBtn.classList.add('locating');
        locateBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const lat = position.coords.latitude;
                const lon = position.coords.longitude;
                userPosition = { lat, lng: lon };
                centerOnUser(map, lat, lon);
                locateBtn.classList.remove('locating');
                locateBtn.innerHTML = '<i class="fas fa-crosshairs"></i>';

                if (lastSelectedCategory) {
                    searchServices(lastSelectedCategory);
                }
            },
            (error) => {
                console.error("Erreur de géolocalisation:", error);
                alert("Impossible de vous localiser. Vérifiez que vous avez autorisé la géolocalisation.");
                locateBtn.classList.remove('locating');
                locateBtn.innerHTML = '<i class="fas fa-crosshairs"></i>';
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
    });
}

/**
 * Affiche ou cache l'indicateur de chargement
 */
function showLoading(isLoading) {
    let loader = document.getElementById('loading-indicator');
    
    if (isLoading) {
        if (!loader) {
            loader = document.createElement('div');
            loader.id = 'loading-indicator';
            loader.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Recherche en cours...';
            document.getElementById('app').appendChild(loader);
        }
        loader.style.display = 'block';
    } else {
        if (loader) loader.style.display = 'none';
    }
}

/**
 * Gère la modale d'urgence
 */
function setupEmergencyModal() {
    const emergencyBtn = document.getElementById('emergency-btn');
    const emergencyModal = document.getElementById('emergency-modal');
    const emergencyClose = document.getElementById('emergency-close');
    const emergencyList = document.getElementById('emergency-list');

    const emergencyNumbers = [
        { name: 'Police Secours', number: '111' },
        { name: 'Pompiers (GSPM)', number: '180' },
        { name: 'SAMU (Urgences médicales)', number: '185' },
        { name: 'Gendarmerie', number: '170' }
    ];

    emergencyNumbers.forEach(item => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span>${item.name}</span>
            <a href="tel:${item.number}" style="color: #e63946; font-weight: bold; text-decoration: none;">
                <i class="fas fa-phone"></i> ${item.number}
            </a>
        `;
        emergencyList.appendChild(li);
    });

    if (emergencyBtn && emergencyModal && emergencyClose) {
        emergencyBtn.addEventListener('click', () => {
            emergencyModal.classList.remove('hidden');
            emergencyModal.setAttribute('aria-hidden', 'false');
        });

        emergencyClose.addEventListener('click', () => {
            emergencyModal.classList.add('hidden');
            emergencyModal.setAttribute('aria-hidden', 'true');
        });

        emergencyModal.addEventListener('click', (e) => {
            if (e.target === emergencyModal) {
                emergencyModal.classList.add('hidden');
                emergencyModal.setAttribute('aria-hidden', 'true');
            }
        });
    }
}

/**
 * Gère la navigation
 */
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        // On ignore le bouton lost-found car il a sa propre logique d'ouverture
        if (item.dataset.screen === 'lost-found') return;

        item.addEventListener('click', () => {
            navItems.forEach(nav => nav.classList.remove('active'));
            item.classList.add('active');
            
            if (item.dataset.screen === 'emergency') {
                document.getElementById('emergency-btn').click();
                setTimeout(() => {
                    navItems.forEach(nav => nav.classList.remove('active'));
                    document.querySelector('.nav-item[data-screen="home"]').classList.add('active');
                }, 100);
            }
        });
    });
}

/**
 * Enregistre le Service Worker
 */
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./service-worker.js')
                .then(registration => {
                    console.log('Service Worker enregistré:', registration.scope);
                })
                .catch(error => {
                    console.error('Échec du Service Worker:', error);
                });
        });
    }
}