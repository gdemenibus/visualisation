import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { load as loadNpy } from "https://esm.sh/npyjs";

// --- Data structures ---
// Map: sampleKey -> { label, sample, channels: {ch1: TypedArray, ch2: TypedArray}[], files: File[] }
let sampleData = new Map();

// --- .npy loading & correlation ---

function pearsonR(x, y) {
    const n = x.length;
    if (n < 2) return NaN;
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

function computeFilteredCorrelation(ch1, ch2, thresh1, thresh2) {
    let n = 0, sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    for (let i = 0; i < ch1.length; i++) {
        if (ch1[i] < thresh1 && ch2[i] < thresh2) continue;
        const x = ch1[i], y = ch2[i];
        n++;
        sumX += x;
        sumY += y;
        sumXY += x * y;
        sumX2 += x * x;
        sumY2 += y * y;
    }
    if (n < 2) return NaN;
    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
    return den === 0 ? 0 : num / den;
}

function getFilterThresholds() {
    return {
        ch1: parseFloat(document.getElementById("filter-ch1").value),
        ch2: parseFloat(document.getElementById("filter-ch2").value),
    };
}

async function processFiles(files) {
    sampleData.clear();

    const npyFiles = Array.from(files).filter(f => f.name.endsWith(".npy"));

    for (const file of npyFiles) {
        const parts = file.webkitRelativePath.split("/");
        if (parts.length < 4) continue;
        const label = parts[1];
        const sample = parts[2];
        const key = `${label}/${sample}`;

        if (!sampleData.has(key)) {
            sampleData.set(key, { label, sample, channels: [], files: [] });
        }

        try {
            const buffer = await file.arrayBuffer();
            const { data, shape } = await loadNpy(buffer);
            if (shape.length === 5 && shape[1] >= 3) {
                const H = shape[3];
                const W = shape[4];
                const planeSize = H * W;
                const ch1 = data.slice(1 * planeSize, 2 * planeSize);
                const ch2 = data.slice(2 * planeSize, 3 * planeSize);
                sampleData.get(key).channels.push({ ch1, ch2 });
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
            lbl.append(cb, ` ${s.sample} (n=${s.channels.length})`);
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

const tooltip = document.getElementById("chart-tooltip");

function getGroupMode() {
    return document.querySelector('input[name="group-mode"]:checked')?.value || "sample";
}

function computeCorrelationsForSample(sampleEntry) {
    const { ch1: thresh1, ch2: thresh2 } = getFilterThresholds();
    return sampleEntry.channels.map(({ ch1, ch2 }) =>
        computeFilteredCorrelation(ch1, ch2, thresh1, thresh2)
    ).filter(r => !isNaN(r));
}

function getSelectedData() {
    const checkboxes = document.querySelectorAll('#file-selector input[type="checkbox"]:checked');
    const keys = Array.from(checkboxes).map(cb => cb.value);

    const mode = getGroupMode();

    if (mode === "sample") {
        return keys.map(k => {
            const d = sampleData.get(k);
            const corrs = computeCorrelationsForSample(d);
            const mean = d3.mean(corrs) || 0;
            const std = d3.deviation(corrs) || 0;
            return { key: k, label: d.label, sample: d.sample, mean, std, n: corrs.length };
        });
    }

    const labelMap = new Map();
    for (const k of keys) {
        const d = sampleData.get(k);
        if (!labelMap.has(d.label)) labelMap.set(d.label, []);
        labelMap.get(d.label).push(...computeCorrelationsForSample(d));
    }
    return Array.from(labelMap, ([label, corrs]) => ({
        key: label,
        label,
        sample: label,
        mean: d3.mean(corrs) || 0,
        std: d3.deviation(corrs) || 0,
        n: corrs.length,
    }));
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
    const mode = getGroupMode();
    xAxisG.transition().call(
        d3.axisBottom(x).tickFormat(d => mode === "label" ? d : d.split("/")[1])
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
        .on("click", (event, d) => { showDetailChart(d.key); openViewer(d.key); })
        .on("mouseenter", (event, d) => {
            tooltip.style.display = "block";
            tooltip.innerHTML = `<strong>${d.key}</strong><br>` +
                `Mean: ${d.mean.toFixed(4)}<br>` +
                `Std: ±${d.std.toFixed(4)}<br>` +
                `Range: [${(d.mean - d.std).toFixed(4)}, ${(d.mean + d.std).toFixed(4)}]<br>` +
                `n = ${d.n}`;
        })
        .on("mousemove", (event) => {
            tooltip.style.left = (event.pageX + 12) + "px";
            tooltip.style.top = (event.pageY - 10) + "px";
        })
        .on("mouseleave", () => {
            tooltip.style.display = "none";
        })
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

// --- Detail Chart (per-file breakdown) ---

const detailContainer = document.getElementById("detail-chart-container");
const detailTitle = document.getElementById("detail-chart-title");
const detailMargin = { top: 30, right: 20, bottom: 80, left: 60 };
const detailWidth = 900;
const detailHeight = 350;

const detailSvg = d3.select("#detail-chart")
    .attr("width", detailWidth)
    .attr("height", detailHeight);

const detailG = detailSvg.append("g")
    .attr("transform", `translate(${detailMargin.left},${detailMargin.top})`);

const detailXAxisG = detailG.append("g")
    .attr("transform", `translate(0,${detailHeight - detailMargin.top - detailMargin.bottom})`);
const detailYAxisG = detailG.append("g");

detailSvg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(detailHeight / 2))
    .attr("y", 16)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--ctp-mocha-text)")
    .attr("font-size", "12px")
    .text("Pearson r");

let detailSelectedKey = null;

function showDetailChart(key) {
    detailSelectedKey = key;
    detailContainer.style.display = "block";
    updateDetailChart();
}

function updateDetailChart() {
    if (!detailSelectedKey) return;

    const { ch1: thresh1, ch2: thresh2 } = getFilterThresholds();
    const mode = getGroupMode();

    // Collect files for this key
    let files = [];
    let channelsList = [];
    if (mode === "sample") {
        const entry = sampleData.get(detailSelectedKey);
        if (!entry) return;
        files = entry.files;
        channelsList = entry.channels;
        detailTitle.textContent = `Files in ${detailSelectedKey}`;
    } else {
        // Label mode: collect from all checked samples with this label
        const checkboxes = document.querySelectorAll('#file-selector input[type="checkbox"]:checked');
        const checkedKeys = Array.from(checkboxes).map(cb => cb.value);
        for (const k of checkedKeys) {
            const d = sampleData.get(k);
            if (d && d.label === detailSelectedKey) {
                files.push(...d.files);
                channelsList.push(...d.channels);
            }
        }
        detailTitle.textContent = `Files in ${detailSelectedKey}`;
    }

    // Compute per-file correlation
    const data = files.map((file, i) => {
        const { ch1, ch2 } = channelsList[i];
        const r = computeFilteredCorrelation(ch1, ch2, thresh1, thresh2);
        return { key: file.name, filename: file.name, r: isNaN(r) ? 0 : r };
    });

    const innerW = detailWidth - detailMargin.left - detailMargin.right;
    const innerH = detailHeight - detailMargin.top - detailMargin.bottom;

    const x = d3.scaleBand()
        .domain(data.map(d => d.key))
        .range([0, innerW])
        .padding(0.1);

    const yMax = d3.max(data, d => d.r) || 1;
    const yMin = d3.min(data, d => d.r) || 0;
    const y = d3.scaleLinear()
        .domain([Math.min(0, yMin - 0.05), Math.max(0.5, yMax + 0.05)])
        .range([innerH, 0]);

    detailXAxisG.call(
        d3.axisBottom(x).tickFormat(d => d.replace(/\.npy$/, ''))
    ).selectAll("text")
        .attr("transform", "rotate(-45)")
        .style("text-anchor", "end")
        .style("font-size", "9px");

    detailYAxisG.call(d3.axisLeft(y));

    // Bars
    const bars = detailG.selectAll(".detail-bar").data(data, d => d.key);
    bars.enter().append("rect")
        .attr("class", "detail-bar")
        .attr("fill", "var(--ctp-mocha-blue, #89b4fa)")
        .attr("opacity", 0.8)
        .style("cursor", "pointer")
        .on("mouseenter", (event, d) => {
            tooltip.style.display = "block";
            tooltip.innerHTML = `<strong>${d.filename}</strong><br>r = ${d.r.toFixed(4)}`;
        })
        .on("mousemove", (event) => {
            tooltip.style.left = (event.pageX + 12) + "px";
            tooltip.style.top = (event.pageY - 10) + "px";
        })
        .on("mouseleave", () => { tooltip.style.display = "none"; })
        .on("click", (event, d) => {
            // Open viewer at this specific file
            const allFiles = getFilesForKey(detailSelectedKey);
            const idx = allFiles.findIndex(f => f.name === d.filename);
            if (idx >= 0) {
                viewerState.title = detailSelectedKey;
                viewerState.files = allFiles;
                viewerState.index = idx;
                viewerEl.style.display = "block";
                renderViewerImage();
            }
        })
      .merge(bars).transition()
        .attr("x", d => x(d.key))
        .attr("width", x.bandwidth())
        .attr("y", d => y(Math.max(0, d.r)))
        .attr("height", d => Math.abs(y(0) - y(d.r)));
    bars.exit().remove();
}

// --- Image Viewer ---

let viewerState = { title: null, files: [], index: 0 };

const viewerEl = document.getElementById("image-viewer");
const viewerTitle = document.getElementById("viewer-title");
const viewerIndex = document.getElementById("viewer-index");

const canvases = [
    document.getElementById("canvas-ch1"),
    document.getElementById("canvas-ch2"),
    document.getElementById("canvas-ch3"),
    document.getElementById("canvas-ch4"),
];

// Channel colors: ch1=blue, ch2=green, ch3=red, ch4=white
const channelColors = [
    [0, 0, 1],
    [0, 1, 0],
    [1, 0, 0],
    [1, 1, 1],
];

document.getElementById("prev-btn").addEventListener("click", () => {
    viewerState.index = (viewerState.index - 1 + viewerState.files.length) % viewerState.files.length;
    renderViewerImage();
});

document.getElementById("next-btn").addEventListener("click", () => {
    viewerState.index = (viewerState.index + 1) % viewerState.files.length;
    renderViewerImage();
});

function getFilesForKey(key) {
    const mode = getGroupMode();
    if (mode === "sample") {
        return sampleData.get(key)?.files || [];
    }
    const checkboxes = document.querySelectorAll('#file-selector input[type="checkbox"]:checked');
    const checkedKeys = Array.from(checkboxes).map(cb => cb.value);
    const files = [];
    for (const k of checkedKeys) {
        const d = sampleData.get(k);
        if (d && d.label === key) files.push(...d.files);
    }
    return files;
}

function openViewer(key) {
    const files = getFilesForKey(key);
    if (files.length === 0) return;
    viewerState.title = key;
    viewerState.files = files;
    viewerState.index = 0;
    viewerEl.style.display = "block";
    renderViewerImage();
}

async function renderViewerImage() {
    const file = viewerState.files[viewerState.index];
    viewerTitle.textContent = `${viewerState.title} — ${file.name}`;
    viewerIndex.textContent = `${viewerState.index + 1} / ${viewerState.files.length}`;

    const buffer = await file.arrayBuffer();
    const { data, shape } = await loadNpy(buffer);

    const H = shape[3];
    const W = shape[4];
    const planeSize = H * W;

    const showFiltered = document.getElementById("show-filtered").checked;
    const { ch1: thresh1, ch2: thresh2 } = getFilterThresholds();

    const planeCh1 = data.slice(1 * planeSize, 2 * planeSize);
    const planeCh2 = data.slice(2 * planeSize, 3 * planeSize);

    // Precompute filter mask (pixels where BOTH ch1 and ch2 are below threshold)
    let filterMask = null;
    if (showFiltered) {
        filterMask = new Uint8Array(planeSize);
        for (let i = 0; i < planeSize; i++) {
            if (planeCh1[i] < thresh1 && planeCh2[i] < thresh2) filterMask[i] = 1;
        }
    }

    // Update scatter plot
    renderScatter(planeCh1, planeCh2, thresh1, thresh2);

    for (let ch = 0; ch < 4; ch++) {
        const cvs = canvases[ch];
        cvs.width = W;
        cvs.height = H;
        const ctxCh = cvs.getContext("2d");
        const imgData = ctxCh.createImageData(W, H);

        const plane = data.slice(ch * planeSize, (ch + 1) * planeSize);
        const [cr, cg, cb] = channelColors[ch];

        let max = 0;
        for (let i = 0; i < planeSize; i++) {
            if (plane[i] > max) max = plane[i];
        }
        if (max === 0) max = 1;

        for (let i = 0; i < planeSize; i++) {
            if (filterMask && filterMask[i]) {
                // Yellow for filtered pixels
                imgData.data[i * 4]     = 255;
                imgData.data[i * 4 + 1] = 220;
                imgData.data[i * 4 + 2] = 0;
            } else {
                const v = (plane[i] / max) * 255;
                imgData.data[i * 4]     = v * cr;
                imgData.data[i * 4 + 1] = v * cg;
                imgData.data[i * 4 + 2] = v * cb;
            }
            imgData.data[i * 4 + 3] = 255;
        }

        ctxCh.putImageData(imgData, 0, 0);
    }
}

// --- Scatter Plot (Ch1 vs Ch2) ---

const scatterMargin = { top: 20, right: 20, bottom: 40, left: 50 };
const scatterWidth = 500;
const scatterHeight = 400;
const MAX_SCATTER_POINTS = 5000;

const scatterSvg = d3.select("#scatter-plot")
    .attr("width", scatterWidth)
    .attr("height", scatterHeight);

const scatterG = scatterSvg.append("g")
    .attr("transform", `translate(${scatterMargin.left},${scatterMargin.top})`);

const scatterXAxisG = scatterG.append("g")
    .attr("transform", `translate(0,${scatterHeight - scatterMargin.top - scatterMargin.bottom})`);
const scatterYAxisG = scatterG.append("g");

scatterSvg.append("text")
    .attr("x", scatterWidth / 2)
    .attr("y", scatterHeight - 4)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--ctp-mocha-text)")
    .attr("font-size", "11px")
    .text("Channel 1");

scatterSvg.append("text")
    .attr("transform", "rotate(-90)")
    .attr("x", -(scatterHeight / 2))
    .attr("y", 14)
    .attr("text-anchor", "middle")
    .attr("fill", "var(--ctp-mocha-text)")
    .attr("font-size", "11px")
    .text("Channel 2");

function renderScatter(dataCh1, dataCh2, thresh1, thresh2) {
    const innerW = scatterWidth - scatterMargin.left - scatterMargin.right;
    const innerH = scatterHeight - scatterMargin.top - scatterMargin.bottom;
    const planeSize = dataCh1.length;

    // Downsample: pick evenly spaced indices
    const step = Math.max(1, Math.floor(planeSize / MAX_SCATTER_POINTS));
    const points = [];
    for (let i = 0; i < planeSize; i += step) {
        const filtered = dataCh1[i] < thresh1 && dataCh2[i] < thresh2;
        points.push({ x: dataCh1[i], y: dataCh2[i], filtered });
    }

    const xMax = d3.max(points, p => p.x) || 1;
    const yMax = d3.max(points, p => p.y) || 1;

    const x = d3.scaleLinear().domain([0, xMax]).range([0, innerW]);
    const y = d3.scaleLinear().domain([0, yMax]).range([innerH, 0]);

    scatterXAxisG.call(d3.axisBottom(x).ticks(6));
    scatterYAxisG.call(d3.axisLeft(y).ticks(6));

    // Draw filtered points first (behind), then included points on top
    const sorted = points.sort((a, b) => b.filtered - a.filtered);

    const dots = scatterG.selectAll(".dot").data(sorted);
    dots.enter().append("circle")
        .attr("class", "dot")
        .attr("r", 1.5)
        .attr("opacity", 0.5)
      .merge(dots)
        .attr("cx", d => x(d.x))
        .attr("cy", d => y(d.y))
        .attr("fill", d => d.filtered ? "#ffdc00" : "#4a9eff");
    dots.exit().remove();
}

// --- Wire up file picker ---

document.getElementById("file-picker").addEventListener("change", (event) => {
    processFiles(event.target.files);
});

// --- Wire up group mode toggle ---

document.querySelectorAll('input[name="group-mode"]').forEach(radio => {
    radio.addEventListener("change", updateChart);
});

// --- Wire up filter sliders (debounced) ---

let filterTimeout = null;
function onFilterChange() {
    document.getElementById("filter-ch1-val").textContent = document.getElementById("filter-ch1").value;
    document.getElementById("filter-ch2-val").textContent = document.getElementById("filter-ch2").value;
    clearTimeout(filterTimeout);
    filterTimeout = setTimeout(() => {
        updateChart();
        if (detailContainer.style.display !== "none") updateDetailChart();
        if (viewerEl.style.display !== "none") renderViewerImage();
    }, 150);
}

document.getElementById("filter-ch1").addEventListener("input", onFilterChange);
document.getElementById("filter-ch2").addEventListener("input", onFilterChange);

// --- Double-click to manually edit threshold values ---

function makeEditable(spanId, sliderId) {
    const span = document.getElementById(spanId);
    const slider = document.getElementById(sliderId);

    span.style.cursor = "pointer";
    span.title = "Double-click to edit";

    span.addEventListener("dblclick", () => {
        const current = span.textContent;
        const input = document.createElement("input");
        input.type = "number";
        input.value = current;
        input.min = slider.min;
        input.max = slider.max;
        input.style.width = "60px";
        span.replaceWith(input);
        input.focus();
        input.select();

        function commit() {
            let val = parseFloat(input.value) || 0;
            val = Math.max(parseFloat(slider.min), Math.min(parseFloat(slider.max), val));
            slider.value = val;
            const newSpan = document.createElement("span");
            newSpan.id = spanId;
            newSpan.textContent = val;
            newSpan.style.cursor = "pointer";
            newSpan.title = "Double-click to edit";
            input.replaceWith(newSpan);
            makeEditable(spanId, sliderId);
            onFilterChange();
        }

        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") input.blur();
            if (e.key === "Escape") {
                input.value = current;
                input.blur();
            }
        });
    });
}

makeEditable("filter-ch1-val", "filter-ch1");
makeEditable("filter-ch2-val", "filter-ch2");

// --- Wire up filter highlight toggle ---

document.getElementById("show-filtered").addEventListener("change", () => {
    if (viewerEl.style.display !== "none") renderViewerImage();
});
