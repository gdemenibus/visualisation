import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

function buildTree(files) {
    const root = {};

    for (const file of files) {
        const parts = file.webkitRelativePath.split("/");
        let current = root;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];

            if (i === parts.length - 1) {
                // file
                current[part] = file;
            } else {
                current[part] ??= {};
                current = current[part];
            }
        }
    }

    return root;
}
function renderTree(node, container, path = "") {
    for (const [name, value] of Object.entries(node)) {

        if (value instanceof File) {
            const label = document.createElement("label");

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = path + name;

            label.append(checkbox, " ", name);

            container.appendChild(label);
            container.appendChild(document.createElement("br"));
        }
        else {
            const details = document.createElement("details");
            details.open = true;

            const summary = document.createElement("summary");
            summary.textContent = name;

            const children = document.createElement("div");
            children.className = "tree-children";

            details.appendChild(summary);

            renderTree(value, children, path + name + "/");

            details.appendChild(children);
            container.appendChild(details);
        }
    }
}
const fileSelector = document.getElementById("file-selector");

document.getElementById("file-picker").addEventListener("change", (event) => {
    fileSelector.innerHTML = "";

    const tree = buildTree(event.target.files);

    renderTree(tree, fileSelector);
});




// Declare the chart dimensions and margins.
const width = 640;
const height = 400;
const marginTop = 20;
const marginRight = 20;
const marginBottom = 30;
const marginLeft = 40;


// Declare the x (horizontal position) scale.
const x = d3.scaleUtc()
    .domain([new Date("2023-01-01"), new Date("2024-01-01")])
    .range([marginLeft, width - marginRight]);

// Declare the y (vertical position) scale.
const y = d3.scaleLinear()
    .domain([0, 100])
    .range([height - marginBottom, marginTop]);

// Create the SVG container.
const svg = d3.select("#plot-container").append("svg")
    .attr("width", width)
    .attr("height", height);

// Add the x-axis.
svg.append("g")
    .attr("transform", `translate(0,${height - marginBottom})`)
    .call(d3.axisBottom(x));

// Add the y-axis.
svg.append("g")
    .attr("transform", `translate(${marginLeft},0)`)
    .call(d3.axisLeft(y));

// Append the SVG element.
//container.append(svg.node());

