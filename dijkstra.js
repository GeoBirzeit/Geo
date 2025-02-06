export function dijkstra(graph, nodesData, start, end,timeData ) {
    // Create a lookup for node access with logging
    const nodeAccessLookup = {};

    if (nodesData && nodesData.features && nodesData.features.length > 0) {
        nodesData.features.forEach(node => {
            const nodeId = node.properties.NODE_ID;
            const access = node.properties.Access;
            nodeAccessLookup[nodeId] = access;
        });
    }

    // Completely filter out inaccessible nodes from the graph
    const filteredGraph = {};
    Object.keys(graph).forEach(node => {
        // Skip completely if node is inaccessible, but allow if it's the start or end node
        if (nodeAccessLookup[node] === 'true' && node !== start && node !== end) {
            
            return;
        }

        // Filter neighbors, removing any inaccessible neighbors
        const filteredNeighbors = graph[node].filter(neighbor => 
            nodeAccessLookup[neighbor.node] !== 'true' || neighbor.node === start || neighbor.node === end
        );

        // Only add to filtered graph if neighbors exist
        if (filteredNeighbors.length > 0) {
            filteredGraph[node] = filteredNeighbors;
        }
    });

    // Check if start and end nodes exist in the filtered graph
    if (!filteredGraph[start]) {
        console.error(`Start node ${start} not found in accessible graph`);
        return [];
    }
    if (!filteredGraph[end]) {
        console.error(`End node ${end} not found in accessible graph`);
        return [];
    }

    console.log(filteredGraph);
    
    let timeMinutes = 0;
    let remainingSeconds = 0;

    let distances = {};
    let predecessors = {};
    let nodes = new PriorityQueue();

    // Initialize nodes in the filtered graph
    Object.keys(filteredGraph).forEach(function(node) {
        if (node === start) {
            distances[node] = 0;
            nodes.enqueue(node, 0);
        } else {
            distances[node] = Infinity;
            nodes.enqueue(node, Infinity);
        }
        predecessors[node] = null;
    });

    // Process the nodes
    while (!nodes.isEmpty()) {
        let closestNode = nodes.dequeue().element;
        
        // If we've reached the end node, break the loop
        if (closestNode === end) {
            break;
        }

        // If no path exists to the end node
        if (distances[closestNode] === Infinity) {
            break;
        }

        // Explore neighbors
        filteredGraph[closestNode].forEach(function(neighbor) {
            let alt = distances[closestNode] + neighbor.weight;
            
            if (alt < distances[neighbor.node]) {
                distances[neighbor.node] = alt;
                predecessors[neighbor.node] = closestNode;
                nodes.enqueue(neighbor.node, distances[neighbor.node]);
            }
        });
    }

    const totalLength = distances[end];
    if (totalLength !== Infinity) {
        

        // Calculate estimated arrival time
        const timeSeconds = totalLength / 1.4;
        timeData.minutes = Math.floor(timeSeconds / 60);
        timeData.seconds = Math.floor(timeSeconds % 60);

        
    } else {
        
        timeData.minutes = null;
        timeData.seconds = null;
        return [];
    }

    // Build the shortest path
    
    let path = [];
    let currentNode = end;

    // Ensure a path exists
    if (predecessors[end] === null && start !== end) {
        console.error(`No path found between ${start} and ${end}`);
        return [];
    }

    while (currentNode !== null) {
        path.unshift(currentNode);
        currentNode = predecessors[currentNode];
        
        // Prevent infinite loop
        if (path.length > Object.keys(filteredGraph).length) {
            console.error('Possible path reconstruction error');
            return [];
        }
    }

    

    return path;
}

// PriorityQueue class remains the same
class PriorityQueue {
    constructor() {
        this.items = [];
    }

    enqueue(element, priority) {
        let queueElement = { element, priority };
        let added = false;
        for (let i = 0; i < this.items.length; i++) {
            if (this.items[i].priority > priority) {
                this.items.splice(i, 0, queueElement);
                added = true;
                break;
            }
        }
        if (!added) {
            this.items.push(queueElement);
        }
    }

    dequeue() {
        return this.items.shift();
    }

    isEmpty() {
        return this.items.length === 0;
    }
}



export function buildGraph(edgesData) {
    const graph = {};

    edgesData.features.forEach(function(edge) {
        const from = edge.properties.Start_NODE;
        const to = edge.properties.End_NODE;
        const weight = edge.properties.Distance;

        if (!graph[from]) graph[from] = [];
        if (!graph[to]) graph[to] = [];

        // Add the edge (bidirectional)
        graph[from].push({ node: to, weight: weight });
        graph[to].push({ node: from, weight: weight });
    });

    return graph;
}

// Load geojson files using fetch
export async function loadGeojsonData(filePath) {
    try {
        const response = await fetch(filePath);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error('Error loading geojson data:', error);
        throw error;
    }
}



