import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { load as loadNpy } from "https://esm.sh/npyjs";

// --- Data structures ---
// Map: sampleKey -> { label, sample, correlations: number[], files: File[] }
let sampleData = new Map();

// --- .npy loading & correlation ---

function pearsonR(x, y) {
    const n = x.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < n; i++) {
        sumX += x[i];
        sumY += y[i];
        sumXY += x[i] * y[i];
        sumX2 += x[i] * x[i];
        sumY2 += y[i] * y[i];
    }
    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    return den === 0 ? 0 : num / den;
}

function computeCorrelation(data, shape) {
    // shape: (1, 4, 1, H, W)
    const H = shape[3];
    const W = shape[4];
    const planeSize = H * W;

    const ch1 = data.slice(1 * planeSize, 2 * planeSize);
    const ch2 = data.slice(2 * planeSize, 3 * planeSize);

    return pearsonR(ch1, ch2);
}

async function processFiles(files) {
    sampleData.clear();

    const npyFiles = Array.from(files).filter(f => f.name.endsWith(".npy"));

    for (const file of npyFiles) {
        const parts = file.webkitRelativePath.split("/");
        // parts: [rootFolder, label, sample, filename]
        if (parts.length < 4) continue;
        const label = parts[1];
        const sample = parts[2];
        const key = `${label}/${sample}`;

        if (!sampleData.has(key)) {
            sampleData.set(key, { label, sample, correlations: [], files: [] });
        }

        try {
            const buffer = await file.arrayBuffer();
            const { data, shape } = await loadNpy(buffer);
            if (shape.length === 5 && shape[1] >= 3) {
                const r = computeCorrelation(data, shape);
                sampleData.get(key).correlations.push(r);
                sampleData.get(key).files.push(file);
            }
        } catch (e) {
            console.warn(`Failed to parse ${file.name}:`, e);
        }
    }

    buildSampleSelector();
}

// --- Sample selector UI ---

function buildSampleSelector() {
    const container = document.getElementById("file-selector");
    container.innerHTML = "";

    const grouped = d3.group(Array.from(sampleData.values()), d => d.label);

    for (const [label, samples] of grouped) {
        const details = document.createElement("details");
        details.open = true;

        const summary = document.createElement("summary");
        summary.textContent = label;
        details.appendChild(summary);

        const children = document.createElement("div");
        children.className = "tree-children";

        for (const s of samples) {
            const lbl = document.createElement("label");
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = true;
            cb.value = `${s.label}/${s.sample}`;
            cb.addEventListener("change", updateChart);
            lbl.append(cb, ` ${s.sample} (n=${s.correlations.length})`);
            children.appendChild(lbl);
            children.appendChild(document.createElement("br"));
        }

        details.appendChild(children);
        container.appendChild(details);
    }

    updateChart();
}

// --- D3 Bar Chart with error bars ---

const margin = { top: 40, right: 20, bottom: 80, left: 60 };
const width = 700;
const height = 420;

const svg = d3.select("#plot-container").append("svg")
    .attr("width", width)
    .attr("height", height);

const chartG = svg.append("g")
    .attr("transform", `translate(${margin.left},${margin.top})`);

const xAxisG = chartG.append("g")
    .attr("transform", `translate(0,${height - margin.top - margin.bottom})`);
const yAxisG = chartG.append("g");

svg.append("text")
    .attr("x", width / 2)
    .attr("y", margin.top / 2)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--ctp-mocha-text)")
    .attr("font-size", "14px")
    .text("Average Pearson Correlation (Ch1 vs Ch2) per Sample");

svg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(height / 2))
    .attr("y", 16)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--ctp-mocha-text)")
    .attr("font-size", "12px")
    .text("Pearson r");

function getSelectedData() {
    const checkboxes = document.querySelectorAll('#file-selector input[type="checkbox"]:checked');
    const keys = Array.from(checkboxes).map(cb => cb.value);
    return keys.map(k => {
        const d = sampleData.get(k);
        const mean = d3.mean(d.correlations);
        const std = d3.deviation(d.correlations) || 0;
        return { key: k, label: d.label, sample: d.sample, mean, std, n: d.correlations.length };
    });
}

function updateChart() {
    const data = getSelectedData();
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const x = d3.scaleBand()
        .domain(data.map(d => d.key))
        .range([0, innerW])
        .padding(0.2);

    const yMax = d3.max(data, d => d.mean + d.std) || 1;
    const yMin = d3.min(data, d => d.mean - d.std) || 0;
    const y = d3.scaleLinear()
        .domain([Math.min(0, yMin - 0.05), Math.max(0.5, yMax + 0.05)])
        .range([innerH, 0]);

    const color = d3.scaleOrdinal(d3.schemeTableau10)
        .domain([...new Set(data.map(d => d.label))]);

    // Axes
    xAxisG.transition().call(
        d3.axisBottom(x).tickFormat(d => d.split("/")[1])
    ).selectAll("text")
        .attr("transform", "rotate(-40)")
        .style("text-anchor", "end");

    yAxisG.transition().call(d3.axisLeft(y));

    // Bars
    const bars = chartG.selectAll(".bar").data(data, d => d.key);
    bars.enter().append("rect")
        .attr("class", "bar")
        .attr("x", d => x(d.key))
        .attr("width", x.bandwidth())
        .attr("y", d => y(Math.max(0, d.mean)))
        .attr("height", d => Math.abs(y(0) - y(d.mean)))
        .attr("fill", d => color(d.label))
        .attr("opacity", 0.8)
        .style("cursor", "pointer")
        .on("click", (event, d) => openViewer(d.key))
      .merge(bars).transition()
        .attr("x", d => x(d.key))
        .attr("width", x.bandwidth())
        .attr("y", d => y(Math.max(0, d.mean)))
        .attr("height", d => Math.abs(y(0) - y(d.mean)))
        .attr("fill", d => color(d.label));
    bars.exit().remove();

    // Error bars (std dev)
    const errLines = chartG.selectAll(".err-line").data(data, d => d.key);
    errLines.enter().append("line")
        .attr("class", "err-line")
        .attr("stroke", "var(--ctp-mocha-text)")
        .attr("stroke-width", 1.5)
      .merge(errLines).transition()
        .attr("x1", d => x(d.key) + x.bandwidth() / 2)
        .attr("x2", d => x(d.key) + x.bandwidth() / 2)
        .attr("y1", d => y(d.mean + d.std))
        .attr("y2", d => y(d.mean - d.std));
    errLines.exit().remove();

    // Error bar caps (top)
    const capW = 8;
    const capsTop = chartG.selectAll(".cap-top").data(data, d => d.key);
    capsTop.enter().append("line")
        .attr("class", "cap-top")
        .attr("stroke", "var(--ctp-mocha-text)")
        .attr("stroke-width", 1.5)
      .merge(capsTop).transition()
        .attr("x1", d => x(d.key) + x.bandwidth() / 2 - capW)
        .attr("x2", d => x(d.key) + x.bandwidth() / 2 + capW)
        .attr("y1", d => y(d.mean + d.std))
        .attr("y2", d => y(d.mean + d.std));
    capsTop.exit().remove();

    // Error bar caps (bottom)
    const capsBot = chartG.selectAll(".cap-bot").data(data, d => d.key);
    capsBot.enter().append("line")
        .attr("class", "cap-bot")
        .attr("stroke", "var(--ctp-mocha-text)")
        .attr("stroke-width", 1.5)
      .merge(capsBot).transition()
        .attr("x1", d => x(d.key) + x.bandwidth() / 2 - capW)
        .attr("x2", d => x(d.key) + x.bandwidth() / 2 + capW)
        .attr("y1", d => y(d.mean - d.std))
        .attr("y2", d => y(d.mean - d.std));
    capsBot.exit().remove();

    // Legend
    svg.selectAll(".legend").remove();
    const labels = [...new Set(data.map(d => d.label))];
    const legend = svg.append("g").attr("class", "legend")
        .attr("transform", `translate(${width - margin.right - 100}, ${margin.top})`);
    labels.forEach((l, i) => {
        const g = legend.append("g").attr("transform", `translate(0, ${i * 20})`);
        g.append("rect").attr("width", 12).attr("height", 12).attr("fill", color(l));
        g.append("text").attr("x", 16).attr("y", 10)
            .attr("fill", "var(--ctp-mocha-text)")
            .attr("font-size", "11px")
            .text(l);
    });
}

// --- Image Viewer ---

let viewerState = { key: null, index: 0 };

const viewerEl = document.getElementById("image-viewer");
const viewerTitle = document.getElementById("viewer-title");
const viewerIndex = document.getElementById("viewer-index");
const canvas = document.getElementById("viewer-canvas");
const ctx = canvas.getContext("2d");

document.getElementById("prev-btn").addEventListener("click", () => {
    const files = sampleData.get(viewerState.key).files;
    viewerState.index = (viewerState.index - 1 + files.length) % files.length;
    renderViewerImage();
});

document.getElementById("next-btn").addEventListener("click", () => {
    const files = sampleData.get(viewerState.key).files;
    viewerState.index = (viewerState.index + 1) % files.length;
    renderViewerImage();
});

function openViewer(sampleKey) {
    viewerState.key = sampleKey;
    viewerState.index = 0;
    viewerEl.style.display = "block";
    renderViewerImage();
}

async function renderViewerImage() {
    const sample = sampleData.get(viewerState.key);
    const file = sample.files[viewerState.index];
    viewerTitle.textContent = `${viewerState.key} — ${file.name}`;
    viewerIndex.textContent = `${viewerState.index + 1} / ${sample.files.length}`;

    const buffer = await file.arrayBuffer();
    const { data, shape } = await loadNpy(buffer);

    const H = shape[3];
    const W = shape[4];
    const planeSize = H * W;

    canvas.width = W;
    canvas.height = H;

    // Render channels 1, 2, 3 as RGB (skip channel 0 which is DAPI/background)
    const imgData = ctx.createImageData(W, H);
    const ch1 = data.slice(1 * planeSize, 2 * planeSize);
    const ch2 = data.slice(2 * planeSize, 3 * planeSize);
    const ch3 = data.slice(3 * planeSize, 4 * planeSize);

    // Find max per channel for normalization
    let max1 = 0, max2 = 0, max3 = 0;
    for (let i = 0; i < planeSize; i++) {
        if (ch1[i] > max1) max1 = ch1[i];
        if (ch2[i] > max2) max2 = ch2[i];
        if (ch3[i] > max3) max3 = ch3[i];
    }

    for (let i = 0; i < planeSize; i++) {
        imgData.data[i * 4]     = (ch1[i] / max1) * 255;  // R
        imgData.data[i * 4 + 1] = (ch2[i] / max2) * 255;  // G
        imgData.data[i * 4 + 2] = (ch3[i] / max3) * 255;  // B
        imgData.data[i * 4 + 3] = 255;                     // A
    }

    ctx.putImageData(imgData, 0, 0);
}

// --- Wire up file picker ---

document.getElementById("file-picker").addEventListener("change", (event) => {
    processFiles(event.target.files);
});
