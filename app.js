import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, updateDoc, doc, arrayUnion, where } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCRXp_TSE4trf7HNP5dA6QjQp3o0LgD3bY",
  authDomain: "unirutas-1724e.firebaseapp.com",
  projectId: "unirutas-1724e",
  storageBucket: "unirutas-1724e.firebasestorage.app",
  messagingSenderId: "949060149395",
  appId: "1:949060149395:web:994e170ead7e1b8bd42d66",
  measurementId: "G-91596BJKR2"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Selectores Vistas y Formularios de Entrada
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const routeForm = document.getElementById('route-form');
const routesContainer = document.getElementById('routes-container');
const logoutBtn = document.getElementById('logout-btn');
const userDisplay = document.getElementById('user-display');
const authSubtitle = document.getElementById('auth-subtitle');

// Selectores de los Filtros de Búsqueda
const searchDestination = document.getElementById('search-destination');
const filterVehicle = document.getElementById('filter-vehicle');

// Toggles de Cambio de Vista de Auth
document.getElementById('go-to-register').addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
    authSubtitle.innerText = "Crea tu cuenta de viajero seguro.";
});
document.getElementById('go-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
    authSubtitle.innerText = "Ingresa a la red de movilidad segura.";
});

// Selectores Modales del Chat e Inyecciones
const chatModal = document.getElementById('chat-modal');
const closeChatBtn = document.getElementById('close-chat-btn');
const chatMessagesContainer = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatRouteTitle = document.getElementById('chat-route-title');
const sosBtn = document.getElementById('sos-btn');
const emergencyToast = document.getElementById('emergency-toast');
const toastUser = document.getElementById('toast-user');

let currentUser = null;
let activeRouteId = null;
let unsubscribeChat = null;
let unsubscribeEmergency = null;
let cachedRoutes = []; // Almacenamiento local para búsquedas ultra-rápidas

// Variables del Mapa
let map = null;
let mapMarkers = {}; // Almacén para borrar y actualizar pines dinámicamente

// Variables de Rastreo GPS en Tiempo Real
let idRastreoVivo = null;   // Almacena el ID del proceso de escucha del GPS
let marcadorUsuario = null; // Guarda el marcador visual del usuario en el mapa
let circuloPrecision = null;// Guarda el anillo difuminado de precisión del GPS

// Variable para el marcador de salida programada
let marcadorSalidaProgramada = null;

// Variable global para rastrear en qué ruta está metido el usuario actualmente
let idRutaActiva = null;

// Variables para rastreo de compañeros en tiempo real
let escuchadorCompañeros = null; // Almacena el unsubscribe de Firebase
let marcadoresCompañeros = {};   // Guarda los pines de tus amigos en el mapa

// Variables globales para poder apagar los escuchadores cuando el usuario cierra sesión
let desuscribirSos = null;
let desuscribirRutas = null;

// El Escudo de UniRutas: Convierte HTML potencialmente peligroso en texto seguro
function sanitizarEntrada(texto) {
    if (!texto) return '';
    return texto
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;")
        .replace(/\//g, "&#x2F;");
}

// ==========================================
// SISTEMA DE EMERGENCIA SOS
// ==========================================
async function activarAlertaSOS() {
    // 1. Verificación de Seguridad: Obligatorio estar logueado
    if (!currentUser) {
        alert("Error: Debes iniciar sesión en la red para emitir una alerta de auxilio.");
        return;
    }

    // Confirmación rápida para evitar falsos positivos táctiles
    const confirmar = confirm("¿Estás seguro de que deseas enviar una alerta de emergencia SOS a la red?");
    if (!confirmar) return;

    // 2. Intentar obtener la ubicación real del usuario mediante el GPS del celular
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(async (position) => {
            const latitud = position.coords.latitude;
            const longitud = position.coords.longitude;

            // 3. Estructura de datos segura para la emergencia
            const datosEmergencia = {
                usuarioId: currentUser.uid,
                usuarioNombre: sanitizarEntrada(currentUser.displayName || "Usuario Anónimo"),
                usuarioCorreo: currentUser.email,
                ubicacion: {
                    lat: latitud,
                    lng: longitud
                },
                estado: "Activo", // Activo / Atendido
                fechaHora: new Date().toISOString() // Hora exacta del servidor
            };

            try {
                // Subir la alerta a la colección de 'emergencias'
                await addDoc(collection(db, "emergencias"), datosEmergencia);
                
                // Efecto visual en la interfaz de UniRutas
                notificarAlertaEnPantalla();
            } catch (error) {
                console.error("Error al enviar el SOS:", error);
                alert("No se pudo enviar la señal de SOS. Intenta de nuevo o busca un lugar seguro.");
            }

        }, (error) => {
            console.error("Error de GPS:", error);
            alert("No pudimos obtener tu ubicación GPS, pero enviaremos la alerta con tus datos de perfil.");
            // Envío alternativo sin coordenadas exactas si el GPS falla
            enviarSOSSinGps();
        });
    } else {
        alert("Tu dispositivo no soporta geolocalización.");
    }
}

// Envío alternativo sin GPS
async function enviarSOSSinGps() {
    try {
        const datosEmergencia = {
            usuarioId: currentUser.uid,
            usuarioNombre: sanitizarEntrada(currentUser.displayName || "Usuario Anónimo"),
            usuarioCorreo: currentUser.email,
            ubicacion: null,
            estado: "Activo",
            fechaHora: new Date().toISOString()
        };
        
        await addDoc(collection(db, "emergencias"), datosEmergencia);
        notificarAlertaEnPantalla();
    } catch (error) {
        console.error("Error al enviar SOS sin GPS:", error);
        alert("No se pudo enviar la señal de SOS. Intenta de nuevo.");
    }
}

// Interfaz: Cambiar visualmente la app al modo de emergencia
function notificarAlertaEnPantalla() {
    // Buscar el contenedor o banner de notificaciones de tu HTML
    const bannerSms = document.body; 
    
    // Crear un banner rojo parpadeante arriba en la app
    const avisoEstilo = document.createElement('div');
    avisoEstilo.style.backgroundColor = '#ff0000';
    avisoEstilo.style.color = '#ffffff';
    avisoEstilo.style.textAlign = 'center';
    avisoEstilo.style.padding = '15px';
    avisoEstilo.style.fontWeight = 'bold';
    avisoEstilo.style.position = 'fixed';
    avisoEstilo.style.top = '0';
    avisoEstilo.style.width = '100%';
    avisoEstilo.style.zIndex = '9999';
    avisoEstilo.textContent = "🚨 ALERTA SOS ENVIADA. Mantén la calma, la red está informada.";

    bannerSms.appendChild(avisoEstilo);

    // Remover el aviso después de 7 segundos
    setTimeout(() => {
        avisoEstilo.remove();
    }, 7000);
}

// ==========================================
// SISTEMA DE REPORTES VIALES (WAZE-STYLE)
// ==========================================
async function reportarIncidente(tipoIncidente) {
    const usuario = auth.currentUser;
    if (!usuario) return alert("Inicia sesión para reportar incidentes.");

    try {
        await addDoc(collection(db, "reportes"), {
            tipo: tipoIncidente,
            reportadoPor: sanitizarEntrada(usuario.displayName || "Usuario Anónimo"),
            usuarioCorreo: usuario.email,
            fechaHora: new Date().toISOString()
        });
        alert(`¡Reporte de "${tipoIncidente}" compartido con la red!`);
    } catch (error) {
        console.error("Error al enviar reporte vial:", error);
        alert("No se pudo enviar el reporte. Intenta de nuevo.");
    }
}

// ==========================================
// ESCUCHADOR EN TIEMPO REAL DE ALERTAS SOS
// ==========================================
function escucharAlertasSOS() {
    const coleccionEmergencias = collection(db, "emergencias");
    
    // Filtramos para escuchar únicamente las emergencias cuyo estado sea "Activo"
    const consultaSosActivos = query(coleccionEmergencias, where("estado", "==", "Activo"));

    // El listener en tiempo real se activa inmediatamente cuando hay cambios
    return onSnapshot(consultaSosActivos, (snapshot) => {
        const contenedorAlertaCabecera = document.getElementById('emergency-toast');
        
        if (!snapshot.empty) {
            // ¡Hay al menos una emergencia activa en la red!
            console.log("🚨 ¡Alerta SOS detectada en la base de datos!");
            
            // Obtenemos los datos de la última alerta para personalizar el mensaje
            const datosEmergencia = snapshot.docs[0].data();
            const nombreAfectado = datosEmergencia.usuarioNombre || "Un usuario";

            // Modificamos el texto y hacemos visible el letrero de la cabecera
            if (contenedorAlertaCabecera) {
                const toastUser = document.getElementById('toast-user');
                if (toastUser) {
                    toastUser.textContent = nombreAfectado;
                }
                contenedorAlertaCabecera.classList.remove('hidden');
                contenedorAlertaCabecera.classList.add('animacion-parpadeo-alerta');
            }
        } else {
            // No hay emergencias activas en este momento
            if (contenedorAlertaCabecera) {
                contenedorAlertaCabecera.classList.add('hidden');
                contenedorAlertaCabecera.classList.remove('animacion-parpadeo-alerta');
            }
        }
    }, (error) => {
        console.error("Error al escuchar alertas SOS en tiempo real: ", error);
    });
}

/* ==========================================
   0. INICIALIZACIÓN DEL MAPA GLOBAL
   ========================================== */
function inicializarMapa() {
    if (map) return; // Evita duplicados

    // Enmarcar los límites máximos permitidos (Suroeste y Noreste de la Sabana de Bogotá)
    const limitesBogota = L.latLngBounds(
        L.latLng(4.4500, -74.2500), // Límite sur/occidente (Soacha / Usme)
        L.latLng(4.8500, -73.9500)  // Límite norte/oriente (Chía / Cerros Orientales)
    );

    // Inicializar el mapa centrado en el corazón de Bogotá (Cerca al centro / Chapinero)
    map = L.map('global-map', {
        center: [4.6516, -74.0611], // Ajustado más hacia el eje de Chapinero/Norte para mejor visibilidad inicial
        zoom: 13,
        minZoom: 12,                // Evita que alejen tanto el mapa que Bogotá se vea diminuta
        maxZoom: 18,                // Nivel de detalle máximo para ver calles
        maxBounds: limitesBogota,   // Activa el bloqueo geográfico
        maxBoundsViscosity: 1.0     // Efecto "resorte": si intentan arrastrar fuera, el mapa los rebota de una
    }); 

    // Capa de mapa Premium en Modo Oscuro (CartoDB DarkMatter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);
    
    // Activar rastreo GPS en tiempo real
    activarUbicacionEnVivo();

    // ESCUCHAR CLICKS EN EL MAPA PARA FIJAR EL PUNTO DE SALIDA EXACTO
    map.on('click', function(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;

        // 1. Guardar las coordenadas exactas en los inputs ocultos del formulario
        document.getElementById('origin-lat').value = lat;
        document.getElementById('origin-lng').value = lng;

        // 2. Colocar un texto amigable en el input visible de Origen
        document.getElementById('origin').value = `Ubicación Exacta (${lat.toFixed(4)}, ${lng.toFixed(4)})`;

        // 3. Dibujar o mover el pin verde de "Punto de Encuentro" en el mapa
        if (marcadorSalidaProgramada) {
            marcadorSalidaProgramada.setLatLng([lat, lng]);
        } else {
            // Creamos un pin verde neón personalizado para la salida
            const puntoSalidaIcon = L.divIcon({
                className: 'custom-output-pin',
                html: `<div style="background: #10B981; width: 24px; height: 24px; border-radius: 50%; border: 3px solid #FFF; box-shadow: 0 0 10px rgba(16,185,129,0.6);"></div>`,
                iconSize: [24, 24]
            });

            marcadorSalidaProgramada = L.marker([lat, lng], { icon: puntoSalidaIcon }).addTo(map);
        }
        
        marcadorSalidaProgramada.bindPopup("<b>📍 Punto de salida seleccionado</b><br>Completa el formulario para lanzar el pelotón.").openPopup();
    });
}

function activarUbicacionEnVivo() {
    if (!navigator.geolocation) {
        console.error("Tu navegador no soporta geolocalización avanzada.");
        return;
    }

    const opcionesGps = {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000
    };

    idRastreoVivo = navigator.geolocation.watchPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            const precision = position.coords.accuracy;

            // 1. Renderizado Local en tu propio Mapa (Lo que ya hacíamos)
            if (!marcadorUsuario) {
                circuloPrecision = L.circle([lat, lng], {
                    radius: precision,
                    color: '#3B82F6',
                    fillColor: '#3B82F6',
                    fillOpacity: 0.15,
                    weight: 1
                }).addTo(map);

                marcadorUsuario = L.circleMarker([lat, lng], {
                    radius: 8,
                    color: '#FFFFFF',
                    weight: 2,
                    fillColor: '#3B82F6',
                    fillOpacity: 1
                }).addTo(map).bindPopup("<b>Tú estás aquí</b>");

                map.setView([lat, lng], 15);
            } else {
                marcadorUsuario.setLatLng([lat, lng]);
                circuloPrecision.setLatLng([lat, lng]);
                circuloPrecision.setRadius(precision);
            }

            // 2. TRANSMISIÓN INTERNACIONAL: Subir coordenadas a Firebase si estás en ruta
            if (idRutaActiva && currentUser) {
                try {
                    // Guardamos la posición usando el UID del usuario como ID del documento
                    // Esto evita duplicados y sobreescribe tu posición vieja con la actual
                    const posicionRef = doc(db, "rutas", idRutaActiva, "posiciones_miembros", currentUser.uid);
                    await setDoc(posicionRef, {
                        nombre: currentUser.displayName || "Viajero Anónimo",
                        email: currentUser.email,
                        latitud: lat,
                        longitud: lng,
                        ultimaActualizacion: new Date().toISOString()
                    });
                } catch (error) {
                    console.error("Error transmitiendo coordenadas a Firebase:", error);
                }
            }
        },
        (error) => {
            console.warn("Error de sincronización GPS:", error.message);
        },
        opcionesGps
    );
}

/* ==========================================
   1. CONTROL DE SESIÓN Y REGISTRO (AUTH)
   ========================================== */
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        userDisplay.innerText = user.displayName || user.email.split('@')[0];
        loginView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        inicializarMapa();
        
        // 🔥 SOLUCIÓN: Activamos las conexiones en vivo SOLO AHORA que ya estamos logueados
        if (!desuscribirRutas) {
            desuscribirRutas = escucharRutas();
        }
        if (!desuscribirSos) {
            desuscribirSos = escucharAlertasSOS();
        }
        
        // Comentamos activarEscuchaEmergenciasGlobal temporalmente para evitar errores de permisos
        // activarEscuchaEmergenciasGlobal();
    } else {
        currentUser = null;
        
        // Si el usuario cierra sesión, apagamos los escuchadores para que no tiren error de permisos
        if (desuscribirRutas) { desuscribirRutas(); desuscribirRutas = null; }
        if (desuscribirSos) { desuscribirSos(); desuscribirSos = null; }
        
        if(unsubscribeChat) unsubscribeChat();
        if(unsubscribeEmergency) unsubscribeEmergency();
        dashboardView.classList.add('hidden');
        loginView.classList.remove('hidden');
    }
});

// Registrar nuevo usuario desde la App
registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    try {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        // Guardar el nombre real dentro del perfil de Firebase Auth
        await updateProfile(userCredential.user, { displayName: name });
        alert("¡Cuenta creada con éxito! Bienvenido a la red.");
        registerForm.reset();
    } catch (error) {
        alert("Error al registrar cuenta: " + error.message);
    }
});

// Loguear Usuario Existente
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;

    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        alert("Error de acceso: " + error.message);
    }
});

logoutBtn.addEventListener('click', () => signOut(auth));

// Event listeners para botones de reporte vial (Waze-Style)
document.getElementById('btn-hueco')?.addEventListener('click', () => reportarIncidente('Hueco Crítico'));
document.getElementById('btn-inundacion')?.addEventListener('click', () => reportarIncidente('Inundación'));
document.getElementById('btn-sospechoso')?.addEventListener('click', () => reportarIncidente('Actividad Sospechosa'));

// Interruptor de Modo Táctico (Negro Puro)
const tacticalBtn = document.getElementById('tactical-mode-btn');
tacticalBtn.addEventListener('click', () => {
    document.body.classList.toggle('tactical-mode');
    tacticalBtn.innerText = document.body.classList.contains('tactical-mode') ? "☀️ Modo Normal" : "🕶️ Modo Táctico";
});

// REPORTE DE WAZE BASADO EN TU POSICIÓN EN VIVO ACTUAL
const reportButtons = document.querySelectorAll('.report-btn');

reportButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        const tipoReporte = btn.getAttribute('data-type');

        // Si el GPS ya leyó dónde está el usuario, clavamos el peligro exactamente ahí
        if (marcadorUsuario) {
            const miUbicacionActual = marcadorUsuario.getLatLng();
            ponerReporteEnMapa(miUbicacionActual.lat, miUbicacionActual.lng, tipoReporte);
        } else {
            // Plan de respaldo si el GPS aún está cargando: usar el centro del mapa
            const centroMapa = map.getCenter();
            ponerReporteEnMapa(centroMapa.lat, centroMapa.lng, tipoReporte);
        }
    });
});

// ==========================================================================
// GESTIÓN Y ACTUALIZACIÓN DEL PERFIL DE USUARIO
// ==========================================================================
const userDisplayBtn = document.getElementById('user-display');
const profileCard = document.getElementById('profile-card');
const closeProfileBtn = document.getElementById('close-profile-btn');
const profileForm = document.getElementById('profile-form');
const profileNameInput = document.getElementById('profile-name');
const profileEmailStatic = document.getElementById('profile-email-static');

// 1. Abrir la tarjeta de perfil al hacer click en el nombre
userDisplayBtn.addEventListener('click', () => {
    if (!currentUser) return;
    
    // Precargar los datos actuales del usuario en los inputs
    profileNameInput.value = currentUser.displayName || "";
    profileEmailStatic.value = currentUser.email;
    
    // Desplegar la tarjeta visualmente
    profileCard.classList.remove('hidden');
    profileCard.scrollIntoView({ behavior: 'smooth' });
});

// 2. Cerrar la tarjeta de perfil
closeProfileBtn.addEventListener('click', () => {
    profileCard.classList.add('hidden');
});

// 3. Procesar el formulario y actualizar los datos en Firebase Auth
profileForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const nuevoNombre = profileNameInput.value.trim();

    if (!nuevoNombre) return;

    try {
        // Enviar la actualización directamente a los servidores de Firebase
        await updateProfile(auth.currentUser, {
            displayName: nuevoNombre
        });

        // Actualizar la interfaz de forma inmediata sin recargar
        userDisplayBtn.innerText = nuevoNombre;
        
        // Ocultar la tarjeta con una transición limpia
        profileCard.classList.add('hidden');
        
        console.log("Perfil actualizado correctamente en la red.");
    } catch (error) {
        console.error("Error al actualizar el perfil:", error.message);
        alert("No se pudo actualizar el nombre: " + error.message);
    }
});

// Función auxiliar para renderizar el marcador de peligro de forma limpia sin alerts
function ponerReporteEnMapa(lat, lng, tipo) {
    if (!map) return;

    // Crear un marcador con el emoji correspondiente
    const alertaMarker = L.marker([lat, lng]).addTo(map);
    alertaMarker.bindPopup(`
        <div style="color: #000; font-family: 'Inter', sans-serif; text-align:center; padding: 2px;">
            <strong style="color: #DC2626;">⚠️ Alerta en la Vía</strong><br>
            <span style="font-size: 15px; font-weight: 600;">${tipo}</span><br>
            <span style="color: #666; font-size: 11px;">Reportado por un usuario aquí</span>
        </div>
    `).openPopup();

    // Opcional: Centrar suavemente el mapa en el peligro reportado para darle feedback visual al usuario
    map.panTo([lat, lng]);
}

function comenzarEscuchaCompañeros(idRuta) {
    // Si ya había una escucha activa de otra ruta, la cerramos
    if (escuchadorCompañeros) escuchadorCompañeros();
    
    // Limpiar marcadores viejos del mapa si existían
    Object.values(marcadoresCompañeros).forEach(m => map.removeLayer(m));
    marcadoresCompañeros = {};

    const posicionesRef = collection(db, "rutas", idRuta, "posiciones_miembros");
    
    // Escucha reactiva en tiempo real de la subcolección
    escuchadorCompañeros = onSnapshot(posicionesRef, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
            const uidCompañero = change.id;
            const datos = change.doc.data();

            // Evitar pintarte a ti mismo como un compañero
            if (currentUser && uidCompañero === currentUser.uid) return;

            if (change.type === "removed") {
                // Si el usuario se sale de la ruta, lo borramos del mapa
                if (marcadoresCompañeros[uidCompañero]) {
                    map.removeLayer(marcadoresCompañeros[uidCompañero]);
                    delete marcadoresCompañeros[uidCompañero];
                }
            } else {
                // Si el usuario se mueve o se conecta nuevo
                const latComp = datos.latitud;
                const lngComp = datos.longitud;

                if (marcadoresCompañeros[uidCompañero]) {
                    // Si ya existía en el mapa, solo actualizamos su posición suavemente
                    marcadoresCompañeros[uidCompañero].setLatLng([latComp, lngComp]);
                } else {
                    // Si es nuevo, creamos un pin naranja neón para diferenciarlo de ti
                    const compañeroIcon = L.divIcon({
                        className: 'companion-pin',
                        html: `<div style="background: #EC4899; width: 20px; height: 20px; border-radius: 50%; border: 2px solid #FFF; box-shadow: 0 0 10px #EC4899;"></div>`,
                        iconSize: [20, 20]
                    });

                    const nuevoMarcador = L.marker([latComp, lngComp], { icon: compañeroIcon })
                        .addTo(map)
                        .bindPopup(`<b>${datos.nombre}</b><br>¡En movimiento con el grupo!`);

                    marcadoresCompañeros[uidCompañero] = nuevoMarcador;
                }
            }
        });
    });
}

/* ==========================================
   2. MOTOR DE FILTROS EN TIEMPO REAL (CLIENTE)
   ========================================== */
function aplicarFiltros() {
    const textoBuscado = searchDestination.value.toLowerCase().trim();
    const transporteSeleccionado = filterVehicle.value;

    // Filtrar la caché local sin hacer lecturas extras a la base de datos
    const rutasFiltradas = cachedRoutes.filter(ruta => {
        const coincideDestino = ruta.destino.toLowerCase().includes(textoBuscado) || ruta.origen.toLowerCase().includes(textoBuscado);
        const coincideTransporte = (transporteSeleccionado === 'todos') || (ruta.creadorVehiculo === transporteSeleccionado);
        return coincideDestino && coincideTransporte;
    });

    renderizarGrid(rutasFiltradas);
}

searchDestination.addEventListener('input', aplicarFiltros);
filterVehicle.addEventListener('change', aplicarFiltros);

/* ==========================================
   3. GESTIÓN DE RUTAS Y VIAJES
   ========================================== */
routeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // FILTRADO DE SEGURIDAD: Sanitizar origen y destino
    const origin = sanitizarEntrada(document.getElementById('origin').value.trim());
    const destination = sanitizarEntrada(document.getElementById('destination').value.trim());
    const time = document.getElementById('time').value;
    const vehicle = document.getElementById('vehicle').value;
    
    // Validar que no estén vacíos después de sanitización
    if (!origin || !destination) {
        alert("Por favor, introduce rutas válidas.");
        return;
    }
    
    // Capturar las coordenadas del click en el mapa
    const latSalida = parseFloat(document.getElementById('origin-lat').value);
    const lngSalida = parseFloat(document.getElementById('origin-lng').value);

    if (isNaN(latSalida) || isNaN(lngSalida)) {
        alert("Por favor, selecciona primero un punto de salida exacto tocando el mapa.");
        return;
    }

    try {
        const docRef = await addDoc(collection(db, "rutas"), {
            origen: origin,
            destino: destination,
            hora: time,
            creador: sanitizarEntrada(currentUser.displayName || currentUser.email.split('@')[0]),
            creadorId: currentUser.uid,
            creadorVehiculo: vehicle,
            miembros: [currentUser.email],
            estado: "programado", 
            sosActivo: false,
            sosLanzadoPor: "",
            // GUARDAMOS LAS COORDENADAS GEOGRÁFICAS REALES
            latitudSalida: latSalida,
            longitudSalida: lngSalida,
            fechaCreacion: new Date().toISOString()
        });

        // Activar transmisión GPS y escucha de compañeros al crear la ruta
        idRutaActiva = docRef.id;
        comenzarEscuchaCompañeros(idRutaActiva);

        // Limpiar formulario y remover el pin temporal del mapa
        routeForm.reset();
        if (marcadorSalidaProgramada) {
            map.removeLayer(marcadorSalidaProgramada);
            marcadorSalidaProgramada = null;
        }
    } catch (error) {
        alert("Error al inyectar pelotón: " + error.message);
    }
});

function escucharRutas() {
    const q = query(collection(db, "rutas"), where("estado", "!=", "finalizado"), orderBy("estado", "desc"));
    
    return onSnapshot(q, (snapshot) => {
        cachedRoutes = [];
        snapshot.forEach((docSnap) => {
            cachedRoutes.push({ id: docSnap.id, ...docSnap.data() });
        });
        aplicarFiltros(); // Renderiza usando el estado actual de los inputs
        actualizarPinesEnMapa(cachedRoutes); // Actualiza pines en el mapa
    });
}

function actualizarPinesEnMapa(rutas) {
    if (!map) return;

    // Limpiar pines viejos del mapa para no acumular fantasmas
    Object.values(mapMarkers).forEach(marker => map.removeLayer(marker));
    mapMarkers = {};

    rutas.forEach(ruta => {
        // Si la ruta tiene coordenadas reales guardadas, las usa. Si es una ruta vieja sin coordenadas, usa un backup.
        const latRuta = ruta.latitudSalida || 4.6516;
        const lngRuta = ruta.longitudSalida || -74.0611;

        const pinIcon = L.divIcon({
            className: 'custom-map-pin',
            html: `<div style="background: ${ruta.estado === 'en_marcha' ? '#F59E0B' : '#3B82F6'}; 
                    width: 32px; height: 32px; border-radius: 50%; border: 2px solid #FFF;
                    display: flex; align-items: center; justify-content: center; 
                    box-shadow: 0 0 15px rgba(0,0,0,0.5); font-size: 14px;">
                    ${ruta.creadorVehiculo.split(' ')[0]}
               </div>`,
            iconSize: [32, 32]
        });

        const nuevoMarker = L.marker([latRuta, lngRuta], { icon: pinIcon })
            .addTo(map)
            .bindPopup(`
                <div style="color: #000; font-family: 'Inter', sans-serif; padding: 4px;">
                    <strong style="font-size:14px; color:var(--primary);">${ruta.origen}</strong><br>
                    <strong>Hacia:</strong> ${ruta.destino}<br>
                    <span>Salida: <b>${ruta.hora}</b></span><br>
                    <span style="color:#475569">Miembros: ${ruta.miembros.length} viajeros</span>
                </div>
            `);

        mapMarkers[ruta.id] = nuevoMarker;
    });
}

function renderizarGrid(listaRutas) {
    routesContainer.innerHTML = '';
    if (listaRutas.length === 0) {
        routesContainer.innerHTML = '<div class="loading">No se encontraron pelotones que coincidan con los filtros.</div>';
        return;
    }
    listaRutas.forEach((ruta) => {
        const yaEstaInscrito = ruta.miembros.includes(currentUser.email);
        const esCreador = ruta.creadorId === currentUser.uid;
        
        let clasePeloton = 'route-card';
        if (ruta.estado === 'en_marcha') clasePeloton += ' en-marcha';
        if (ruta.miembros.length >= 5) clasePeloton += ' gold-squad';
        
        const card = document.createElement('div');
        card.className = clasePeloton;
        
        card.innerHTML = `
            <div class="route-info">
                <h3>${ruta.origen} ➔ ${ruta.destino}</h3>
                <p>Salida: <strong>${ruta.hora}</strong> • Organiza: ${ruta.creador}</p>
                <div style="display:flex; gap:8px; align-items:center;">
                    <span class="vehicle-tag">${ruta.creadorVehiculo}</span>
                    <span class="badge-status status-${ruta.estado}">${ruta.estado === 'en_marcha' ? '⚡ En ruta' : '⏳ Programado'}</span>
                </div>
            </div>
            <div class="route-meta">
                <span class="badge">${ruta.miembros.length} viajeros</span>
                <div style="display:flex; gap:6px;">
                    ${yaEstaInscrito ? `<button class="btn btn-secondary btn-sm chat-btn" data-id="${ruta.id}" data-title="${ruta.origen} ➔ ${ruta.destino}">Chat</button>` : ''}
                    
                    ${esCreador && ruta.estado === 'programado' ? `<button class="btn btn-accent btn-sm status-btn" data-id="${ruta.id}" data-next="en_marcha" style="background:#EAB308;">Arrancar</button>` : ''}
                    ${esCreador && ruta.estado === 'en_marcha' ? `<button class="btn btn-secondary btn-sm status-btn" data-id="${ruta.id}" data-next="finalizado" style="border-color:var(--danger); color:var(--danger)">Terminar</button>` : ''}
                    
                    ${!yaEstaInscrito ? `<button class="btn btn-accent btn-sm join-btn" data-id="${ruta.id}">Unirme</button>` : ''}
                </div>
            </div>
        `;

        const joinBtn = card.querySelector('.join-btn');
        if (joinBtn) joinBtn.addEventListener('click', () => unirseAPeloton(ruta.id));

        const chatBtn = card.querySelector('.chat-btn');
        if (chatBtn) chatBtn.addEventListener('click', () => abrirChatDeRuta(ruta.id, chatBtn.getAttribute('data-title')));

        const statusBtn = card.querySelector('.status-btn');
        if (statusBtn) {
            statusBtn.addEventListener('click', () => cambiarEstadoRuta(ruta.id, statusBtn.getAttribute('data-next')));
        }

        routesContainer.appendChild(card);
    });
}

async function unirseAPeloton(idRuta) {
    try {
        await updateDoc(doc(db, "rutas", idRuta), { miembros: arrayUnion(currentUser.email) });
        
        // Activar transmisión GPS y escucha de compañeros al unirse a la ruta
        idRutaActiva = idRuta;
        comenzarEscuchaCompañeros(idRutaActiva);
    } catch (error) { console.error(error); }
}

async function cambiarEstadoRuta(idRuta, proximoEstado) {
    try {
        await updateDoc(doc(db, "rutas", idRuta), { estado: proximoEstado });
    } catch (error) { console.error(error); }
}

/* ==========================================
   4. CHAT Y ALERTAS SOS EN VIVO
   ========================================== */
function abrirChatDeRuta(idRuta, tituloRuta) {
    activeRouteId = idRuta;
    chatRouteTitle.innerText = tituloRuta;
    chatModal.classList.remove('hidden');
    chatMessagesContainer.innerHTML = '<div class="loading">Sincronizando canal...</div>';

    if (unsubscribeChat) unsubscribeChat();

    const q = query(collection(db, "rutas", idRuta, "mensajes"), orderBy("timestamp", "asc"));
    unsubscribeChat = onSnapshot(q, (snapshot) => {
        chatMessagesContainer.innerHTML = '';
        snapshot.forEach((docSnap) => {
            const msg = docSnap.data();
            const esMio = msg.remitenteId === currentUser.uid;
            const bubble = document.createElement('div');
            bubble.className = `message ${esMio ? 'outgoing' : 'incoming'}`;
            bubble.innerHTML = `<span class="meta">${esMio ? 'Tú' : msg.nombre}</span><p>${msg.texto}</p>`;
            chatMessagesContainer.appendChild(bubble);
        });
        chatMessagesContainer.scrollTop = chatMessagesContainer.scrollHeight;
    });
}

chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!activeRouteId || !chatInput.value.trim()) return;
    
    // APLICAMOS LA SEGURIDAD: Sanitizar el mensaje antes de enviarlo
    const txt = sanitizarEntrada(chatInput.value.trim());
    
    chatInput.value = '';

    try {
        await addDoc(collection(db, "rutas", activeRouteId, "mensajes"), {
            texto: txt,
            remitenteId: currentUser.uid,
            nombre: sanitizarEntrada(currentUser.displayName || currentUser.email.split('@')[0]),
            timestamp: new Date().toISOString()
        });
    } catch (error) { console.error(error); }
});

closeChatBtn.addEventListener('click', () => {
    chatModal.classList.add('hidden');
    if (unsubscribeChat) { unsubscribeChat(); unsubscribeChat = null; }
    activeRouteId = null;
});

sosBtn.addEventListener('click', async () => {
    if (!activeRouteId) return;
    if (confirm("🚨 ¿CONFIRMAS EL LLAMADO DE SOS? Esto alertará inmediatamente a tus compañeros de ruta.")) {
        try {
            await updateDoc(doc(db, "rutas", activeRouteId), {
                sosActivo: true,
                sosLanzadoPor: currentUser.displayName || currentUser.email.split('@')[0]
            });
        } catch (error) { console.error(error); }
    }
});

function activarEscuchaEmergenciasGlobal() {
    const q = query(collection(db, "rutas"), where("miembros", "array-contains", currentUser.email));
    
    unsubscribeEmergency = onSnapshot(q, (snapshot) => {
        snapshot.forEach((docSnap) => {
            const ruta = docSnap.data();
            const miNombreCorto = currentUser.displayName || currentUser.email.split('@')[0];
            if (ruta.sosActivo === true && ruta.sosLanzadoPor !== miNombreCorto) {
                
                toastUser.innerText = ruta.sosLanzadoPor;
                emergencyToast.classList.remove('hidden');
                emitirAlertaPorVoz(ruta.sosLanzadoPor);
                
                setTimeout(() => {
                    emergencyToast.classList.add('hidden');
                    updateDoc(doc(db, "rutas", docSnap.id), { sosActivo: false });
                }, 8000);
            }
        });
    }, (error) => {
        console.error("Error en escucha de emergencias globales:", error);
    });
}

function emitirAlertaPorVoz(nombreUsuario) {
    if ('speechSynthesis' in window) {
        const mensajeVoz = new SpeechSynthesisUtterance();
        mensajeVoz.text = `Atención, atención. El usuario ${nombreUsuario} ha activado una alerta de emergencia en tu ruta. Por favor, verifica el mapa y mantente agrupado.`;
        mensajeVoz.lang = 'es-ES';
        mensajeVoz.rate = 1.0;
        mensajeVoz.pitch = 1.1;
        
        window.speechSynthesis.speak(mensajeVoz);
    }
}
