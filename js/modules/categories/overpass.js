// js/modules/categories/overpass.js

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/**
 * Récupère les services autour d'une position via l'API Overpass
 * @param {string} query - La requête Overpass QL
 * @returns {Promise<Array>} - Liste des éléments (nodes/ways) trouvés
 */
export async function fetchOverpass(query) {
    try {
        const response = await fetch(OVERPASS_URL, {
            method: 'POST',
            body: query,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        if (!response.ok) {
            throw new Error(`Erreur Overpass : ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        // On normalise les résultats pour avoir toujours lat/lon
        return data.elements.map(element => {
            // Si c'est un node, on a directement lat/lon
            // Si c'est un way ou relation, Overpass nous donne "center"
            const lat = element.lat || element.center?.lat;
            const lon = element.lon || element.center?.lon;
            
            if (!lat || !lon) return null; // On ignore si pas de coordonnées

            return {
                id: element.id,
                type: element.type,
                lat: lat,
                lon: lon,
                tags: element.tags || {},
                name: element.tags?.name || 'Sans nom'
            };
        }).filter(item => item !== null); // On retire les éléments sans coordonnées
        
    } catch (error) {
        console.error('Erreur lors de la requête Overpass :', error);
        throw error;
    }
}