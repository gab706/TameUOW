(() => {
  "use strict";

  const WAM_CLASS = "tameuow-wam-display";

  const isNumeric = (value) => value !== "" && Number.isFinite(Number(value));

  const getGrade = (wam) => {
    if (wam >= 85) return "High Distinction";
    if (wam >= 75) return "Distinction";
    if (wam >= 65) return "Credit";
    if (wam >= 50) return "Pass";
    return "Fail";
  };

  const cleanText = (value) => {
    const text = typeof value === "string" ? value : value?.textContent || "";
    return text.replace(/\s+/g, " ").trim();
  };

  const parseNumber = (value) => {
    const text = cleanText(value);
    return text === "" ? NaN : Number(text);
  };

  const getCellByHeader = (headers, cells, label) => {
    const index = headers.findIndex((header) => header.toLowerCase() === label.toLowerCase());
    return index >= 0 ? cells[index] : null;
  };

  const createWamDisplay = ({ wam, grade, totalCP }) => {
    const div = document.createElement("div");
    div.className = WAM_CLASS;
    div.style.marginBottom = "20px";
    div.innerHTML = `
      <strong>Calculated Weighted Average Mark (WAM)</strong>
      <table class="table table-striped table-bordered" style="margin-top: 10px;">
        <thead class="cf">
          <tr align="center">
            <th>WAM</th>
            <th>Grade</th>
            <th>Counted CP</th>
          </tr>
        </thead>
        <tbody>
          <tr align="center">
            <td>${wam}</td>
            <td>${grade}</td>
            <td>${totalCP}</td>
          </tr>
        </tbody>
      </table>
      <hr class="divider" style="width: 80%;">
    `;
    return div;
  };

  const calculateTableWam = (table) => {
    const headers = [...table.querySelectorAll("thead th")].map(cleanText);
    let totalMarks = 0;
    let totalCP = 0;

    table.querySelectorAll("tbody tr").forEach((row) => {
      const cells = [...row.querySelectorAll("td")];
      const status = cleanText(getCellByHeader(headers, cells, "Status"));
      const cp = parseNumber(getCellByHeader(headers, cells, "NomCP"));
      const mark = parseNumber(getCellByHeader(headers, cells, "Mark"));

      if (status.toLowerCase() === "complete" && isNumeric(cp) && isNumeric(mark)) {
        totalMarks += mark * cp;
        totalCP += cp;
      }
    });

    if (!totalCP) {
      return {
        wam: "No WAM Score Yet",
        grade: "No Grade Yet",
        totalCP: 0
      };
    }

    const wam = totalMarks / totalCP;
    return {
      wam: wam.toFixed(2),
      grade: getGrade(wam),
      totalCP
    };
  };

  const findCourseTables = () =>
    [...document.querySelectorAll('[id^="course_details"]')]
      .map((courseDetails) => {
        let node = courseDetails.nextElementSibling;
        while (node && node.tagName !== "TABLE") {
          node = node.nextElementSibling;
        }
        return node ? { courseDetails, table: node } : null;
      })
      .filter(Boolean);

  const render = () => {
    document.querySelectorAll(`.${WAM_CLASS}`).forEach((node) => node.remove());

    const courseTables = findCourseTables();
    const targets = courseTables.length
      ? courseTables
      : [...document.querySelectorAll("table.table-striped")].map((table) => ({
          courseDetails: null,
          table
        }));

    targets.forEach(({ table }) => {
      const wam = calculateTableWam(table);
      table.parentElement?.insertBefore(createWamDisplay(wam), table);
    });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render, { once: true });
  } else {
    render();
  }
})();
