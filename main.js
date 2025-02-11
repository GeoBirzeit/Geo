import { dijkstra, buildGraph } from './dijkstra.js';
import GraphicsLayer from "https://js.arcgis.com/4.28/@arcgis/core/layers/GraphicsLayer.js";
import Graphic from "https://js.arcgis.com/4.28/@arcgis/core/Graphic.js";
import Point from "https://js.arcgis.com/4.28/@arcgis/core/geometry/Point.js";
import Polyline from "https://js.arcgis.com/4.28/@arcgis/core/geometry/Polyline.js";
import esriConfig from "https://js.arcgis.com/4.28/@arcgis/core/config.js";
import Basemap from "https://js.arcgis.com/4.28/@arcgis/core/Basemap.js";
import VectorTileLayer from "https://js.arcgis.com/4.28/@arcgis/core/layers/VectorTileLayer.js";

document.addEventListener("DOMContentLoaded", async function() {
    // Import ESRI modules
    const Map = await import("https://js.arcgis.com/4.28/@arcgis/core/Map.js").then(module => module.default);
    const SceneView = await import("https://js.arcgis.com/4.28/@arcgis/core/views/SceneView.js").then(module => module.default);
    const GeoJSONLayer = await import("https://js.arcgis.com/4.28/@arcgis/core/layers/GeoJSONLayer.js").then(module => module.default);
    const Popup = await import("https://js.arcgis.com/4.28/@arcgis/core/widgets/Popup.js").then(module => module.default);

    let testModeActive = false;
    let testClickHandler = null;

    let nodesData = null;
    let edgesData = null;
    let routeGraphicsLayer = null;
    let currentBackdrop = null;
    let userTrackingEnabled = false;
    let userGraphicsLayer = null;
    let watchId = null;
    let currentPath = [];
    let originalPath = [];
    let currentRouteGraphics = [];
    let retryCount = 0;
let lastKnownPosition = null;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds
let positionHistory = [];
const HISTORY_SIZE = 5;
let lastUpdateTime = 0;
const MIN_UPDATE_INTERVAL = 1000; // Minimum time between updates in milliseconds
let recoveryTimeout = null;
let isRecovering = false;


class KalmanFilter {
    constructor() {
        this.Q = 0.005; // Process noise
        this.R = 0.05;  // Measurement noise
        this.P = 1.0;   // Estimation error
        this.x = null;  // State
        this.y = null;
    }

    filter(measurement, isLat) {
        if (this.x === null) {
            this.x = measurement;
            return measurement;
        }

        // Prediction
        const pTemp = this.P + this.Q;

        // Update
        const K = pTemp / (pTemp + this.R);
        this.x = this.x + K * (measurement - this.x);
        this.P = (1 - K) * pTemp;

        return this.x;
    }
}

const latFilter = new KalmanFilter();
const lonFilter = new KalmanFilter();



    // Create renderer for buildings
    const buildingRenderer = {
        type: "simple",
        symbol: {
            type: "polygon-3d",
            symbolLayers: [{
                type: "extrude",
                size: 10,
                material: {
                    color: [79, 129, 189, 0.5]
                },
                edges: {
                    type: "solid",
                    color: [0, 0, 0, 0.5],
                    size: 1
                }
            }]
        }
    };

    // Create renderer for edges (polylines)
    const edgeRenderer = {
        type: "simple",
        symbol: {
            type: "line-3d",
            symbolLayers: [{
                type: "line",
                material: { color: [255, 0, 0, 0.8] },
                size: 2
            }]
        }
    };

    // Create renderer for nodes (points)
    const nodeRenderer = {
        type: "simple",
        symbol: {
            type: "point-3d",
            symbolLayers: [{
                type: "icon",
                size: 10,
                material: { color: [0, 255, 0] },
                outline: {
                    color: [255, 255, 255],
                    size: 1
                }
            }]
        }
    };

    // Create the GeoJSON layers
    const buildingsLayer = new GeoJSONLayer({
        url: "./Building.geojson",
        renderer: buildingRenderer,
        title: "Buildings"
    });

    const edgesLayer = new GeoJSONLayer({
        url: "./Edges.geojson",
        renderer: edgeRenderer,
        title: "Edges"
    });

    const nodesLayer = new GeoJSONLayer({
        url: "./Nodes.geojson",
        renderer: nodeRenderer,
        title: "Nodes",
        // Add labelingInfo configuration
        labelingInfo: [{
            labelExpressionInfo: {
                expression: "$feature.NODE_ID"  // Use the NODE_ID field
            },
            symbol: {
                type: "label-3d",
                symbolLayers: [{
                    type: "text",
                    material: {
                        color: [0, 0, 0]  // Black text
                    },
                    size: 10,  // Text size
                    halo: {
                        color: [255, 255, 255, 0.8],  // White halo
                        size: 1
                    }
                }],
                verticalOffset: {
                    screenLength: 20,  // Offset above the point
                    maxWorldLength: 100,
                    minWorldLength: 10
                },
                callout: {
                    type: "line",  // Line connecting label to point
                    size: 0.5,
                    color: [0, 0, 0, 0.6],
                    border: {
                        color: [255, 255, 255, 0.7]
                    }
                }
            }
        }]
    });


    esriConfig.apiKey = "AAPTxy8BH1VEsoebNVZXo8HurLpw4KUM9AUDNlBQ_vcddRlnOV_Ptnc10cPTezgn8hviDrZty3CSCWyMEx3dvm2jyoRg0fs5aj5bjTlYcEdtDgRPrYxFq1CVfGb8upF-qtcZGnb1L7_VZUK3njmP1mYmQi83USY6w2uyta2fXdaLniFJmG5EUQm80m5zfCLPz6D479zc7xjW2q2l1Wsg-_szrqG87Iv4uHo959RAGHT7GZA.AT1_gg4No0cl";
    
    const basemap = new Basemap({
        baseLayers: [
          new VectorTileLayer({
            portalItem: {
              id: "0e4f29c52a4c4120a536b0ed22d1292d" // Custom basemap style
            }
          })
        ]
      });
    // Create the map
    const map = new Map({
        basemap: basemap,
        ground: "world",
        layers: [buildingsLayer, edgesLayer, nodesLayer]
    });

    // Create the view
    const view = new SceneView({
        container: "viewDiv",
        map: map,
        camera: {
            position: {
                x: 35.1820951,
                y: 31.96072992,
                z: 500
            },
            tilt: 45
        },
        ui: {
            components: [] // Removes all default UI components
        }
    });

    // Add camera control functions
    window.tiltUp = function() {
        const camera = view.camera.clone();
        camera.tilt = Math.min(camera.tilt + 5, 90);
        view.goTo(camera);
    };

    window.tiltDown = function() {
        const camera = view.camera.clone();
        camera.tilt = Math.max(camera.tilt - 5, 0);
        view.goTo(camera);
    };


    function createLegend(view) {
        const legendContainer = document.createElement('div');
        legendContainer.id = 'mapLegend';
        legendContainer.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            background-color: rgba(255, 255, 255, 0.9);
            border-radius: 8px;
            padding: 15px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            max-width: 250px;
            z-index: 1000;
        `;
    
        const legendEntries = [
            {
                layer: buildingsLayer,
                name: 'Buildings',
                color: 'rgba(79, 129, 189, 0.5)',
                type: 'polygon'
            },
            {
                layer: edgesLayer,
                name: 'Edges',
                color: 'rgba(255, 0, 0, 0.8)',
                type: 'line'
            },
            {
                layer: nodesLayer,
                name: 'Nodes',
                color: 'rgba(0, 255, 0, 1)',
                type: 'point'
            }
        ];
    
        legendEntries.forEach(entry => {
            const legendItem = document.createElement('div');
            legendItem.style.cssText = `
                display: flex;
                align-items: center;
                margin-bottom: 10px;
            `;
    
            // Create visibility toggle
            const toggleSwitch = document.createElement('input');
            toggleSwitch.type = 'checkbox';
            toggleSwitch.checked = true;
            toggleSwitch.style.cssText = `
                margin-right: 10px;
                width: 18px;
                height: 18px;
            `;
    
            // Add toggle functionality
            toggleSwitch.addEventListener('change', (e) => {
                entry.layer.visible = e.target.checked;
            });
    
            // Create symbol
            const symbolEl = document.createElement('div');
            symbolEl.style.cssText = `
                width: 30px;
                height: 30px;
                margin-right: 10px;
                background-color: ${entry.color};
                ${entry.type === 'line' ? 'height: 4px;' : ''}
                ${entry.type === 'point' ? 'border-radius: 50%;' : ''}
            `;
    
            // Create label
            const labelEl = document.createElement('span');
            labelEl.textContent = entry.name;
            labelEl.style.fontFamily = 'Arial, sans-serif';
            labelEl.style.fontSize = '14px';
    
            legendItem.appendChild(toggleSwitch);
            legendItem.appendChild(symbolEl);
            legendItem.appendChild(labelEl);
            legendContainer.appendChild(legendItem);
        });
    
        // Existing drag functionality remains the same as in previous implementation
    
        document.body.appendChild(legendContainer);
        return legendContainer;
    }
    // Zoom to layer extent when loaded
    view.when(() => {
        buildingsLayer.when(() => {
            view.goTo({
                target: buildingsLayer.fullExtent,
                tilt: 45
            });
    
            // Create legend after layer is loaded
            createLegend(view);
        }).catch(err => {
            console.error("Error loading buildings layer:", err);
        });
    });



function createDebugOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'debugOverlay';
    overlay.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 10px;
        border-radius: 5px;
        font-family: monospace;
        z-index: 1000;
        max-width: 300px;
    `;
    document.body.appendChild(overlay);
    return overlay;
}


function createStatusIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'trackingStatus';
    indicator.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background-color: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 14px;
        z-index: 1000;
        display: none;
    `;
    document.body.appendChild(indicator);
    return indicator;
}

const statusIndicator = createStatusIndicator();

function updateStatusIndicator(message, type = 'info') {
    const colors = {
        info: '#2196F3',
        error: '#F44336',
        success: '#4CAF50',
        warning: '#FF9800'
    };
    
    statusIndicator.style.display = 'block';
    statusIndicator.style.backgroundColor = colors[type];
    statusIndicator.textContent = message;
    
    // Hide after 3 seconds for info and success messages
    if (type === 'info' || type === 'success') {
        setTimeout(() => {
            statusIndicator.style.display = 'none';
        }, 3000);
    }
}

// Enhanced error handling function
function handleGeolocationError(error) {
    console.warn('Geolocation error:', error);
    
    if (error.code === error.POSITION_UNAVAILABLE && !isRecovering) {
        isRecovering = true;
        
        // Use last known position if available
        if (positionHistory.length > 0) {
            const lastPosition = positionHistory[positionHistory.length - 1];
            updateUserLocation(lastPosition, view);
        }
        
        // Clear existing recovery timeout
        if (recoveryTimeout) {
            clearTimeout(recoveryTimeout);
        }
        
        // Attempt recovery after a short delay
        recoveryTimeout = setTimeout(() => {
            restartTracking();
            isRecovering = false;
        }, 2000);
    }
}

// Function to restart tracking
function restartTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
    }
    
    watchId = navigator.geolocation.watchPosition(
        (position) => {
            retryCount = 0; // Reset retry count on successful position
            lastKnownPosition = position;
            updateUserLocation(position, view);
            updateRouteForPosition(position, view, edgesData, nodesData, currentPath[currentPath.length - 1]);
            updateStatusIndicator('Tracking active', 'success');
        },
        handleGeolocationError,
        {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 10000 // Increased timeout to 10 seconds
        }
    );
}


    function findClosestPointOnEdge(userLat, userLon, edge) {
        const [x1, y1] = edge.geometry.coordinates[0];
        const [x2, y2] = edge.geometry.coordinates[1];
        
        // Convert to meters using simple approximation
        const mPerDegLat = 111320;
        const mPerDegLon = 111320 * Math.cos(userLat * Math.PI / 180);
        
        const A = (userLon - x1) * mPerDegLon;
        const B = (userLat - y1) * mPerDegLat;
        const C = (x2 - x1) * mPerDegLon;
        const D = (y2 - y1) * mPerDegLat;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) param = dot / lenSq;
        
        let xx, yy;
        
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * (x2 - x1);
            yy = y1 + param * (y2 - y1);
        }
        
        return {
            point: [xx, yy],
            distance: Math.sqrt(
                Math.pow((userLon - xx) * mPerDegLon, 2) +
                Math.pow((userLat - yy) * mPerDegLat, 2)
            ),
            param: param
        };
    }

    
    function updateUserLocation(position, view) {
        const debugOverlay = document.getElementById('debugOverlay') || createDebugOverlay();
        
        // Debug output
        debugOverlay.innerHTML = `
            Lat: ${position.coords.latitude.toFixed(6)}<br>
            Lon: ${position.coords.longitude.toFixed(6)}<br>
            Accuracy: ${position.coords.accuracy.toFixed(1)}m<br>
            Timestamp: ${new Date(position.timestamp).toLocaleTimeString()}
        `;
    
        // Ensure GraphicsLayer exists
        if (!userGraphicsLayer) {
            console.log('Creating new GraphicsLayer');
            userGraphicsLayer = new GraphicsLayer();
            view.map.add(userGraphicsLayer);
        }
    
        // Clear existing graphics
        userGraphicsLayer.removeAll();
    
        // Create point for user location
        const point = new Point({
            longitude: position.coords.longitude,
            latitude: position.coords.latitude,
            spatialReference: { wkid: 4326 }
        });
    
        // Create user location marker with better visibility
        const userGraphic = new Graphic({
            geometry: point,
            symbol: {
                type: "simple-marker",
                style: "circle",
                color: [0, 119, 255, 0.8],
                size: "20px",  // Increased size
                outline: {
                    color: [255, 255, 255],
                    width: 3
                }
            }
        });
    
        // Create accuracy circle
        const accuracyGraphic = new Graphic({
            geometry: point,
            symbol: {
                type: "simple-marker",
                style: "circle",
                color: [0, 119, 255, 0.2],
                size: `${position.coords.accuracy}m`,
                outline: {
                    color: [0, 119, 255, 0.5],
                    width: 2
                }
            }
        });
    
        // Add graphics to layer
        userGraphicsLayer.addMany([accuracyGraphic, userGraphic]);
    
        // Center view on user location if needed
        view.goTo({
            target: point,
            zoom: view.zoom,  // Maintain current zoom level
            duration: 500
        });
    }

    function updateRouteForPosition(position, view, edgesData, nodesData, endNodeId) {
        if (!position || !edgesData || !nodesData || !endNodeId || !currentPath) {
            console.warn('Missing required data for route update');
            return;
        }
    
        const userPoint = [position.coords.longitude, position.coords.latitude];
        
        // Find closest edge in the current route
        let closestEdge = null;
        let minDistance = Infinity;
        let closestPointInfo = null;
        let closestSegmentIndex = 0;
        
        // Iterate through route segments to find closest edge
        for (let i = 0; i < currentPath.length - 1; i++) {
            const currentNodeId = currentPath[i];
            const nextNodeId = currentPath[i + 1];
            
            const edge = edgesData.features.find(e => 
                (e.properties.Start_NODE === currentNodeId && e.properties.End_NODE === nextNodeId) ||
                (e.properties.End_NODE === currentNodeId && e.properties.Start_NODE === nextNodeId)
            );
            
            if (edge) {
                const pointInfo = findClosestPointOnEdge(
                    position.coords.latitude,
                    position.coords.longitude,
                    edge
                );
                
                if (pointInfo.distance < minDistance) {
                    minDistance = pointInfo.distance;
                    closestEdge = edge;
                    closestPointInfo = pointInfo;
                    closestSegmentIndex = i;
                }
            }
        }
    
        // If user has deviated significantly from route (> 20 meters)
        if (minDistance > 20) {
            console.log('User deviated from route, recalculating...');
            // Find nearest node to user's current position
            const nearestNode = findNearestNode(
                position.coords.latitude,
                position.coords.longitude,
                nodesData
            );
            
            if (nearestNode) {
                const graph = buildGraph(edgesData);
                const timeData = { minutes: 0, seconds: 0 };
                const newPath = dijkstra(graph, nodesData, nearestNode.properties.NODE_ID, endNodeId, timeData);
                
                if (newPath.length > 0) {
                    console.log('New route calculated:', newPath);
                    currentPath = newPath;
                    displayUpdatedRoute(newPath, userPoint, view);
                }
            }
        } else if (closestPointInfo && closestEdge) {
            // User is following route - update from current position
            const remainingPath = currentPath.slice(closestSegmentIndex + 1);
            const updatedPath = [{ 
                type: "Feature",
                geometry: {
                    type: "Point",
                    coordinates: closestPointInfo.point
                },
                properties: { NODE_ID: "current" }
            }, ...remainingPath.map(nodeId => 
                nodesData.features.find(n => n.properties.NODE_ID === nodeId)
            ).filter(Boolean)];
            
            console.log('Updating route display with current position');
            displayUpdatedRoute(updatedPath.map(n => n.properties.NODE_ID), closestPointInfo.point, view);
        }
    }

function displayUpdatedRoute(path, startPoint, view) {
    if (!routeGraphicsLayer) {
        routeGraphicsLayer = new GraphicsLayer();
        view.map.add(routeGraphicsLayer);
    }
    
    routeGraphicsLayer.removeAll();
    
    // Convert path nodes to coordinates
    const pathCoordinates = [startPoint];
    path.forEach(nodeId => {
        if (nodeId !== "current") {
            const node = nodesData.features.find(f => f.properties.NODE_ID === nodeId);
            if (node) {
                pathCoordinates.push(node.geometry.coordinates);
            }
        }
    });
    
    // Create and style the route line
    const routePolyline = new Polyline({
        paths: [pathCoordinates],
        spatialReference: { wkid: 4326 }
    });
    
    const routeGraphic = new Graphic({
        geometry: routePolyline,
        symbol: {
            type: "line-3d",
            symbolLayers: [{
                type: "line",
                size: 8,
                material: { color: [0, 255, 255, 0.8] },
                cap: "round",
                join: "round"
            }]
        }
    });
    
    routeGraphicsLayer.add(routeGraphic);
}

// Function to start real-time tracking
// First, modify the startRealTimeTracking function
function startRealTimeTracking(view, edgesData, nodesData, endNodeId) {
    console.log('Starting real-time tracking...');
    
    // Clear existing tracking if any
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    userTrackingEnabled = true;
    const debugOverlay = document.getElementById('debugOverlay') || createDebugOverlay();

    // Create user graphics layer if it doesn't exist
    if (!userGraphicsLayer) {
        userGraphicsLayer = new GraphicsLayer({
            elevationInfo: {
                mode: "relative-to-ground",
                offset: 1  // 1 meter above ground
            }
        });
        view.map.add(userGraphicsLayer);
    }

    const options = {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0
    };

    function handleSuccess(position) {
        console.log('Position received:', position);
        
        // Clear any existing graphics first
        if (userGraphicsLayer) {
            userGraphicsLayer.removeAll();
        }

        // Create point for user location
        const point = new Point({
            longitude: position.coords.longitude,
            latitude: position.coords.latitude,
            spatialReference: { wkid: 4326 }
        });

        // Create user location marker optimized for mobile
        const userGraphic = new Graphic({
            geometry: point,
            symbol: {
                type: "simple-marker",
                style: "circle",
                color: [0, 119, 255, 0.8],
                size: "12px",  // Slightly smaller for mobile
                outline: {
                    color: [255, 255, 255],
                    width: 2
                }
            }
        });

        // Add graphic to layer
        userGraphicsLayer.add(userGraphic);
        
        // Update position and route
        updateUserLocation(position, view);
        if (edgesData && nodesData && endNodeId) {
            updateRouteForPosition(position, view, edgesData, nodesData, endNodeId);
        }

        updateStatusIndicator('Location updated', 'success');
    }

    function handleError(error) {
        console.error('Geolocation error:', error);
        let errorMsg = '';
        
        switch(error.code) {
            case error.PERMISSION_DENIED:
                errorMsg = 'Please enable location access in your device settings';
                break;
            case error.POSITION_UNAVAILABLE:
                errorMsg = 'Location information unavailable';
                break;
            case error.TIMEOUT:
                errorMsg = 'Location request timed out';
                break;
            default:
                errorMsg = 'Unknown location error';
        }
        
        updateStatusIndicator(errorMsg, 'error');
        
        // Force permission check and request on error
        requestLocationPermission();
    }

    function requestLocationPermission() {
        if (!navigator.permissions || !navigator.permissions.query) {
            // Fallback for browsers that don't support permissions API
            navigator.geolocation.getCurrentPosition(
                () => startTracking(),
                (error) => updateStatusIndicator('Please enable location access', 'error'),
                options
            );
            return;
        }

        navigator.permissions.query({ name: 'geolocation' }).then(function(result) {
            if (result.state === 'granted') {
                startTracking();
            } else if (result.state === 'prompt') {
                // Force a permission prompt
                navigator.geolocation.getCurrentPosition(
                    () => startTracking(),
                    (error) => updateStatusIndicator('Please enable location access', 'error'),
                    options
                );
            } else {
                updateStatusIndicator('Location access denied. Please enable in settings.', 'error');
            }
        });
    }

    function startTracking() {
        // Get initial position
        navigator.geolocation.getCurrentPosition(handleSuccess, handleError, options);
        
        // Start continuous tracking
        watchId = navigator.geolocation.watchPosition(handleSuccess, handleError, options);
    }

    // Start the process
    requestLocationPermission();
}

function restartTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    
    if (userTrackingEnabled) {
        startRealTimeTracking(view, edgesData, nodesData, currentPath[currentPath.length - 1]);
    }
}

// Updated stop tracking function
function stopRealTimeTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    userTrackingEnabled = false;
    retryCount = 0;
    lastKnownPosition = null;
    
    if (userGraphicsLayer) {
        userGraphicsLayer.removeAll();
    }
    
    updateStatusIndicator('Tracking stopped', 'info');
    setTimeout(() => {
        statusIndicator.style.display = 'none';
    }, 3000);
}
    function calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371e3; // Earth's radius in meters
        const φ1 = lat1 * Math.PI/180;
        const φ2 = lat2 * Math.PI/180;
        const Δφ = (lat2-lat1) * Math.PI/180;
        const Δλ = (lon2-lon1) * Math.PI/180;

        const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ/2) * Math.sin(Δλ/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c; // Distance in meters
    }

    function findNearestNode(latitude, longitude, nodes) {
        let nearestNode = null;
        let minDistance = Infinity;

        nodes.features.forEach(node => {
            const distance = calculateDistance(
                latitude,
                longitude,
                node.geometry.coordinates[1],
                node.geometry.coordinates[0]
            );

            if (distance < minDistance) {
                minDistance = distance;
                nearestNode = node;
            }
        });

        return nearestNode;
    }

    // Add this function after the existing imports
function displayRoute(path) {
    // Initialize route graphics layer if it doesn't exist
    if (!routeGraphicsLayer) {
        routeGraphicsLayer = new GraphicsLayer();
        map.add(routeGraphicsLayer);
    }

    // Clear existing route graphics
    routeGraphicsLayer.removeAll();

    // Create an array to store the path coordinates
    const pathCoordinates = [];

    // Extract coordinates for each node in the path
    path.forEach(nodeId => {
        const node = nodesData.features.find(f => f.properties.NODE_ID === nodeId);
        if (node) {
            pathCoordinates.push([
                node.geometry.coordinates[0],
                node.geometry.coordinates[1],
                node.geometry.coordinates[2] || 0 // Include Z coordinate if available
            ]);
        }
    });

    // Create a polyline geometry
    const routePolyline = new Polyline({
        paths: [pathCoordinates],
        spatialReference: { wkid: 4326 }
    });

    // Create a graphic for the route with custom styling
    const routeGraphic = new Graphic({
        geometry: routePolyline,
        symbol: {
            type: "line-3d",
            symbolLayers: [{
                type: "line",
                size: 8,
                material: { color: [0, 255, 255, 0.8] }, // Cyan color
                cap: "round",
                join: "round"
            }]
        }
    });

    // Add the route graphic to the layer
    routeGraphicsLayer.add(routeGraphic);

    // Create point markers for start and end nodes
    const startPoint = new Point({
        longitude: pathCoordinates[0][0],
        latitude: pathCoordinates[0][1],
        z: pathCoordinates[0][2],
        spatialReference: { wkid: 4326 }
    });

    const endPoint = new Point({
        longitude: pathCoordinates[pathCoordinates.length - 1][0],
        latitude: pathCoordinates[pathCoordinates.length - 1][1],
        z: pathCoordinates[pathCoordinates.length - 1][2],
        spatialReference: { wkid: 4326 }
    });

    // Add start and end point markers
    routeGraphicsLayer.addMany([
        new Graphic({
            geometry: startPoint,
            symbol: {
                type: "point-3d",
                symbolLayers: [{
                    type: "icon",
                    size: 15,
                    material: { color: [0, 255, 0] }, // Green for start
                    outline: { color: [255, 255, 255], size: 1 }
                }]
            }
        }),
        new Graphic({
            geometry: endPoint,
            symbol: {
                type: "point-3d",
                symbolLayers: [{
                    type: "icon",
                    size: 15,
                    material: { color: [255, 0, 0] }, // Red for end
                    outline: { color: [255, 255, 255], size: 1 }
                }]
            }
        })
    ]);
}

    // Function to load nodes data
    async function loadNodesData() {
        try {
            const response = await fetch('./Nodes.geojson');
            nodesData = await response.json();
            return nodesData;
        } catch (error) {
            console.error('Error loading nodes data:', error);
        }
    }

    // Function to load edges data
    async function loadEdgesData() {
        try {
            const response = await fetch('./Edges.geojson');
            edgesData = await response.json();
            return edgesData;
        } catch (error) {
            console.error('Error loading edges data:', error);
        }
    }

    // Function to create node selection dialog
    function createNodeSelectionDialog(nodes, onSelect) {
        const dialog = document.createElement('div');
        dialog.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
            z-index: 1000;
            max-height: 80vh;
            width: 400px;
        `;
    
        const dialogTitle = document.createElement('h3');
        dialogTitle.textContent = 'Select Route Nodes';
        dialogTitle.style.marginBottom = '15px';
        dialog.appendChild(dialogTitle);

        const startContainer = document.createElement('div');
        startContainer.style.display = 'flex';
        startContainer.style.gap = '10px';
        startContainer.style.marginBottom = '20px';
    
        // Create start node input and datalist
        const startLabel = document.createElement('label');
        startLabel.textContent = 'Start Node:';
        startLabel.style.display = 'block';
        startLabel.style.marginBottom = '5px';
    
        const startDatalist = document.createElement('datalist');
        startDatalist.id = 'startNodes';
        
        const startInput = document.createElement('input');
        startInput.setAttribute('list', 'startNodes');
        startInput.placeholder = 'Type or select start node...';
        startInput.style.cssText = `
            width: 100%;
            padding: 8px;
            margin-bottom: 20px;
            border: 1px solid #ddd;
            border-radius: 4px;
        `;

        const geoButton = document.createElement('button');
geoButton.innerHTML = `
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7z"/>
    <circle cx="12" cy="9" r="3"/>
  </svg>
`;

geoButton.style.cssText = `
    padding: 8px;
    background: #4CAF50;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
`;

geoButton.querySelector('svg').style.cssText = `
    width: 24px;
    height: 24px;
`;
    
        // Create end node input and datalist
        const endLabel = document.createElement('label');
        endLabel.textContent = 'End Node:';
        endLabel.style.display = 'block';
        endLabel.style.marginBottom = '5px';
    
        const endDatalist = document.createElement('datalist');
        endDatalist.id = 'endNodes';
        
        const endInput = document.createElement('input');
        endInput.setAttribute('list', 'endNodes');
        endInput.placeholder = 'Type or select end node...';
        endInput.style.cssText = `
            width: 100%;
            padding: 8px;
            margin-bottom: 20px;
            border: 1px solid #ddd;
            border-radius: 4px;
        `;
    
        // Populate datalists
        nodes.features.forEach(node => {
            const startOption = document.createElement('option');
            const endOption = document.createElement('option');
            startOption.value = `Node ${node.properties.NODE_ID}`;
            endOption.value = `Node ${node.properties.NODE_ID}`;
            startDatalist.appendChild(startOption);
            endDatalist.appendChild(endOption);
        });
    
        // Create confirm button
        const confirmButton = document.createElement('button');
        confirmButton.textContent = 'Find Route';
        confirmButton.style.cssText = `
            width: 100%;
            padding: 10px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: bold;
        `;
    
        // Add backdrop
        const backdrop = document.createElement('div');
        backdrop.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 999;
        `;
    
        // Handle confirmation
        geoButton.addEventListener('click', () => {
            if ('geolocation' in navigator) {
                geoButton.disabled = true;
                geoButton.style.opacity = '0.7';

                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const nearestNode = findNearestNode(
                            position.coords.latitude,
                            position.coords.longitude,
                            nodes
                        );

                        if (nearestNode) {
                            startInput.value = `Node ${nearestNode.properties.NODE_ID}`;
                        }

                        geoButton.disabled = false;
                        geoButton.style.opacity = '1';
                    },
                    (error) => {
                        console.error('Geolocation error:', error);
                        alert('Unable to get your location. Please select manually.');
                        geoButton.disabled = false;
                        geoButton.style.opacity = '1';
                    }
                );
            } else {
                alert('Geolocation is not supported by your browser');
            }
        });
        confirmButton.addEventListener('click', () => {
            // Extract node IDs from the input values
            const startNodeId = startInput.value.replace('Node ', '');
            const endNodeId = endInput.value.replace('Node ', '');
            
            if (!startNodeId || !endNodeId) {
                alert('Please select both start and end nodes');
                return;
            }
            
            cleanup();
            onSelect(startNodeId, endNodeId);
        });
    
        // Cleanup function
        const cleanup = () => {
            if (dialog && dialog.parentNode) {
                document.body.removeChild(dialog);
            }
            if (backdrop && backdrop.parentNode) {
                document.body.removeChild(backdrop);
            }
        };
    
        // Add click handler to backdrop
        backdrop.addEventListener('click', cleanup);
    

        // Assemble the start container
        startContainer.appendChild(startInput);
        startContainer.appendChild(geoButton);
        // Assemble the dialog
        dialog.appendChild(startLabel);
        dialog.appendChild(startContainer);
        dialog.appendChild(startDatalist);
        dialog.appendChild(startInput);
        dialog.appendChild(startDatalist);
        dialog.appendChild(endLabel);
        dialog.appendChild(endInput);
        dialog.appendChild(endDatalist);
        dialog.appendChild(confirmButton);
    
        document.body.appendChild(backdrop);
        document.body.appendChild(dialog);
    }
    
    // Update the route button click handler
    document.getElementById('routeButton').addEventListener('click', async () => {
        if (!nodesData) {
            nodesData = await loadNodesData();
        }
        if (!edgesData) {
            edgesData = await loadEdgesData();
        }
        
        createNodeSelectionDialog(nodesData, (startNode, endNode) => {
            const graph = buildGraph(edgesData);
            const timeData = { minutes: 0, seconds: 0 };
            const path = dijkstra(graph, nodesData, startNode, endNode, timeData);
            
            if (path.length > 0) {
                originalPath = [...path];
                currentPath = [...path];
                displayRoute(path);
                
                // Store the end node ID for route updates
                const endNodeId = endNode;
                
                // Start tracking with proper parameters
                startRealTimeTracking(view, edgesData, nodesData, endNodeId);
                updateStatusIndicator('Route found and tracking started', 'success');
            } else {
                updateStatusIndicator('No route found between selected nodes', 'error');
            }
        });
    });
    






    // testing user location mode


// Function to enable test mode
window.startTestMode = function() {
    if (testModeActive) {
        console.log('Test mode is already active. Call stopTestMode() first if you want to restart it.');
        return;
    }

    // Stop actual tracking if it's running
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }

    testModeActive = true;
    console.log('Test mode activated. Click anywhere on the map to simulate user position.');
    
    // Create test mode indicator
    const indicator = document.createElement('div');
    indicator.id = 'testModeIndicator';
    indicator.style.cssText = `
        position: fixed;
        top: 10px;
        left: 50%;
        transform: translateX(-50%);
        background-color: #ff4444;
        color: white;
        padding: 8px 16px;
        border-radius: 4px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        z-index: 1000;
    `;
    indicator.textContent = '🔴 TEST MODE ACTIVE';
    document.body.appendChild(indicator);

    // Add click handler
    testClickHandler = view.on('click', function(event) {
        // Get the map point directly from the event
        const point = view.toMap(event);
        
        // Create mock position object matching geolocation API format
        const mockPosition = {
            coords: {
                latitude: point.latitude,
                longitude: point.longitude,
                accuracy: 10,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null
            },
            timestamp: Date.now()
        };

        // Update user location and route
        updateUserLocation(mockPosition, view);
        if (edgesData && nodesData && currentPath) {
            updateRouteForPosition(
                mockPosition, 
                view, 
                edgesData, 
                nodesData, 
                currentPath[currentPath.length - 1]
            );
        }

        console.log(`Test position updated to: ${point.latitude}, ${point.longitude}`);
    });
};

// Function to disable test mode
window.stopTestMode = function() {
    if (!testModeActive) {
        console.log('Test mode is not active.');
        return;
    }

    if (testClickHandler) {
        testClickHandler.remove();
        testClickHandler = null;
    }

    testModeActive = false;

    // Remove test mode indicator
    const indicator = document.getElementById('testModeIndicator');
    if (indicator) {
        indicator.remove();
    }

    // Clear any test graphics
    if (userGraphicsLayer) {
        userGraphicsLayer.removeAll();
    }

    console.log('Test mode deactivated.');
};

// Function to toggle test mode
window.toggleTestMode = function() {
    if (testModeActive) {
        window.stopTestMode();
    } else {
        window.startTestMode();
    }
};



    
});
