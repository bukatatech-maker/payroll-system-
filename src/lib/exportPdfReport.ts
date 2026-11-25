import { jsPDF } from 'jspdf';
import { formatZmw } from './roles.ts';
import type { DashboardSummary } from '../types/payroll.ts';

async function svgToPngDataUrl(
  svgElement: SVGSVGElement
): Promise<{ dataUrl: string; width: number; height: number } | null> {
  try {
    const rect = svgElement.getBoundingClientRect();
    const viewBox = svgElement.viewBox.baseVal;
    const width = Math.max(320, Math.round(viewBox?.width || rect.width || 760));
    const height = Math.max(200, Math.round(viewBox?.height || rect.height || 270));

    const clone = svgElement.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(width));
    clone.setAttribute('height', String(height));

    const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('x', '0');
    bg.setAttribute('y', '0');
    bg.setAttribute('width', String(width));
    bg.setAttribute('height', String(height));
    bg.setAttribute('fill', '#ffffff');
    clone.insertBefore(bg, clone.firstChild);

    const serialized = new XMLSerializer().serializeToString(clone);
    const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    const img = new Image();
    img.crossOrigin = 'anonymous';

    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = url;
    });

    if (!loaded) {
      URL.revokeObjectURL(url);
      return null;
    }

    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      URL.revokeObjectURL(url);
      return null;
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);

    return {
      dataUrl: canvas.toDataURL('image/png'),
      width,
      height,
    };
  } catch {
    return null;
  }
}

export async function exportOverviewPdfReport(params: {
  data: DashboardSummary;
  dateRange: { start_month: string; end_month: string };
  svgElement: SVGSVGElement | null;
  generatedBy: string;
}): Promise<string> {
  const { data, dateRange, svgElement, generatedBy } = params;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = 210;
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  let y = 16;

  // Header Accent & Title
  doc.setFillColor(4, 120, 87); // #047857 emerald-700
  doc.rect(margin, y, contentWidth, 1.2, 'F');
  y += 6;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text('One Payroll Management System', margin, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text('Transparency & Accountability Executive Report', margin, y + 5);

  const generatedStamp = new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  doc.text(`Period: ${dateRange.start_month} to ${dateRange.end_month}`, pageWidth - margin, y, {
    align: 'right',
  });
  doc.text(`Generated: ${generatedStamp} · ${generatedBy}`, pageWidth - margin, y + 5, {
    align: 'right',
  });
  y += 11;

  // Procedural Fairness Notice Box
  doc.setDrawColor(226, 232, 240);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, y, contentWidth, 13, 1.5, 1.5, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(4, 120, 87);
  doc.text('PROCEDURAL FAIRNESS & UNIFIED CONTROL SAFEGUARD', margin + 3, y + 5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(
    'Automated flags open review cases with assigned deadlines and never trigger automatic salary stoppages.',
    margin + 3,
    y + 10
  );
  y += 18;

  // KPI Grid (2 rows x 4 columns)
  const kpis = [
    { label: 'Station Verification', value: `${data.verified_station_pct}%`, sub: `${data.verified_station_count}/${data.total_staff} verified` },
    { label: 'Active Exception Cases', value: String(data.open_cases_count), sub: `${data.resolved_cases_count} resolved in period` },
    { label: 'Flagged Variance (ZMW)', value: formatZmw(data.total_exposure_zmw), sub: `Gross: ${formatZmw(data.total_monthly_gross_zmw)}` },
    { label: 'Pending Validations', value: String(data.pending_validations_count), sub: `${data.reconciliation_discrepancies_count} PMEC mismatches` },
  ];

  const colGap = 3;
  const cardW = (contentWidth - colGap * 3) / 4;
  const cardH = 19;

  kpis.forEach((kpi, idx) => {
    const x = margin + idx * (cardW + colGap);
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, 'FD');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.label, x + 3, y + 5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11.5);
    doc.setTextColor(15, 23, 42);
    doc.text(kpi.value, x + 3, y + 11.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(kpi.sub, x + 3, y + 16.2);
  });
  y += cardH + 7;

  // D3 Line Chart Snapshot
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(
    `Monthly Payroll Variance & Exception Case Trend (${dateRange.start_month} to ${dateRange.end_month})`,
    margin,
    y
  );
  y += 3;

  if (svgElement) {
    const chartImg = await svgToPngDataUrl(svgElement);
    if (chartImg) {
      const renderH = Math.min(64, (chartImg.height / chartImg.width) * contentWidth);
      doc.setDrawColor(226, 232, 240);
      doc.rect(margin, y, contentWidth, renderH + 2);
      doc.addImage(chartImg.dataUrl, 'PNG', margin + 1, y + 1, contentWidth - 2, renderH);
      y += renderH + 7;
    }
  }

  // Monthly Trend Data Summary Table
  if (data.monthly_trends && data.monthly_trends.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, contentWidth, 6.5, 'F');
    doc.setTextColor(71, 85, 105);
    doc.text('Month', margin + 2.5, y + 4.4);
    doc.text('Exception Cases', margin + 54, y + 4.4, { align: 'right' });
    doc.text('Resolved Cases', margin + 102, y + 4.4, { align: 'right' });
    doc.text('Payroll Variance (ZMW)', pageWidth - margin - 2.5, y + 4.4, { align: 'right' });
    y += 6.5;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    for (const row of data.monthly_trends) {
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y + 6, pageWidth - margin, y + 6);
      doc.setTextColor(15, 23, 42);
      doc.text(row.label, margin + 2.5, y + 4.2);
      doc.text(String(row.exception_cases), margin + 54, y + 4.2, { align: 'right' });
      doc.text(String(row.resolved_cases), margin + 102, y + 4.2, { align: 'right' });
      doc.text(formatZmw(row.payroll_variance_zmw), pageWidth - margin - 2.5, y + 4.2, {
        align: 'right',
      });
      y += 6;
    }
    y += 7;
  }

  // Urgent Payroll Alerts (>10% variance spike)
  if (data.urgent_payroll_alerts && data.urgent_payroll_alerts.length > 0) {
    if (y > 225) {
      doc.addPage();
      y = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(185, 28, 28);
    doc.text('Urgent Payroll Alerts (Stations Exceeding +10% Variance Spike)', margin, y);
    y += 4;

    doc.setFontSize(8);
    doc.setFillColor(254, 242, 242);
    doc.rect(margin, y, contentWidth, 6.5, 'F');
    doc.setTextColor(127, 29, 29);
    doc.text('Station & District', margin + 2.5, y + 4.4);
    doc.text('Prior Baseline', margin + 96, y + 4.4, { align: 'right' });
    doc.text('Current Variance', margin + 134, y + 4.4, { align: 'right' });
    doc.text('Spike', margin + 162, y + 4.4, { align: 'right' });
    doc.text('Cases', pageWidth - margin - 2.5, y + 4.4, { align: 'right' });
    y += 6.5;

    doc.setFont('helvetica', 'normal');
    for (const alert of data.urgent_payroll_alerts) {
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y + 6, pageWidth - margin, y + 6);
      doc.setTextColor(15, 23, 42);
      doc.text(`${alert.station_name.slice(0, 32)} (${alert.district})`, margin + 2.5, y + 4.2);
      doc.setTextColor(71, 85, 105);
      doc.text(formatZmw(alert.baseline_variance_zmw), margin + 96, y + 4.2, { align: 'right' });
      doc.setTextColor(15, 23, 42);
      doc.text(formatZmw(alert.current_variance_zmw), margin + 134, y + 4.2, { align: 'right' });
      doc.setTextColor(185, 28, 28);
      doc.text(`+${alert.spike_pct.toFixed(1)}%`, margin + 162, y + 4.2, { align: 'right' });
      doc.setTextColor(180, 83, 9);
      doc.text(String(alert.open_cases_count), pageWidth - margin - 2.5, y + 4.2, { align: 'right' });
      y += 6;
    }
    y += 7;
  }

  // Check if page break needed before Rules & Districts tables
  if (y > 215) {
    doc.addPage();
    y = 18;
  }

  // Continuous Validation Rules Table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text('Automated Validation Rules & Auditor General Mapping', margin, y);
  y += 4;

  doc.setFontSize(8);
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, y, contentWidth, 6.5, 'F');
  doc.setTextColor(71, 85, 105);
  doc.text('Control Rule', margin + 2.5, y + 4.4);
  doc.text('Audit Finding Addressed', margin + 62, y + 4.4);
  doc.text('Open', margin + 158, y + 4.4, { align: 'right' });
  doc.text('Resolved', pageWidth - margin - 2.5, y + 4.4, { align: 'right' });
  y += 6.5;

  doc.setFont('helvetica', 'normal');
  for (const rule of data.rule_breakdown) {
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y + 6, pageWidth - margin, y + 6);
    doc.setTextColor(15, 23, 42);
    doc.text(rule.rule_label.slice(0, 34), margin + 2.5, y + 4.2);
    doc.setTextColor(71, 85, 105);
    doc.text(rule.audit_finding.slice(0, 52), margin + 62, y + 4.2);
    doc.setTextColor(180, 83, 9);
    doc.text(String(rule.open_count), margin + 158, y + 4.2, { align: 'right' });
    doc.setTextColor(4, 120, 87);
    doc.text(String(rule.resolved_count), pageWidth - margin - 2.5, y + 4.2, {
      align: 'right',
    });
    y += 6;
  }
  y += 8;

  if (y > 235) {
    doc.addPage();
    y = 18;
  }

  // Pilot District Coverage Table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text('Pilot District Coverage', margin, y);
  y += 4;

  doc.setFontSize(8);
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, y, contentWidth, 6.5, 'F');
  doc.setTextColor(71, 85, 105);
  doc.text('District', margin + 2.5, y + 4.4);
  doc.text('Stations', margin + 68, y + 4.4, { align: 'right' });
  doc.text('Staff Count', margin + 106, y + 4.4, { align: 'right' });
  doc.text('Verified', margin + 144, y + 4.4, { align: 'right' });
  doc.text('Open Cases', pageWidth - margin - 2.5, y + 4.4, { align: 'right' });
  y += 6.5;

  doc.setFont('helvetica', 'normal');
  for (const d of data.district_breakdown) {
    doc.setDrawColor(226, 232, 240);
    doc.line(margin, y + 6, pageWidth - margin, y + 6);
    doc.setTextColor(15, 23, 42);
    doc.text(d.district, margin + 2.5, y + 4.2);
    doc.text(String(d.station_count), margin + 68, y + 4.2, { align: 'right' });
    doc.text(String(d.staff_count), margin + 106, y + 4.2, { align: 'right' });
    doc.text(`${d.verified_count}/${d.staff_count}`, margin + 144, y + 4.2, { align: 'right' });
    doc.text(String(d.open_cases), pageWidth - margin - 2.5, y + 4.2, { align: 'right' });
    y += 6;
  }
  y += 8;

  // Regional Payroll Anomalies Hotspots
  if (data.regional_anomalies && data.regional_anomalies.length > 0) {
    if (y > 225) {
      doc.addPage();
      y = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('Regional Payroll Anomalies & Geographic Priority', margin, y);
    y += 4;

    doc.setFontSize(8);
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, contentWidth, 6.5, 'F');
    doc.setTextColor(71, 85, 105);
    doc.text('District (Province)', margin + 2.5, y + 4.4);
    doc.text('Priority', margin + 78, y + 4.4);
    doc.text('Open Cases', margin + 126, y + 4.4, { align: 'right' });
    doc.text('Flagged Exposure (ZMW)', pageWidth - margin - 2.5, y + 4.4, { align: 'right' });
    y += 6.5;

    doc.setFont('helvetica', 'normal');
    for (const reg of data.regional_anomalies) {
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y + 6, pageWidth - margin, y + 6);
      doc.setTextColor(15, 23, 42);
      doc.text(`${reg.district} (${reg.province})`, margin + 2.5, y + 4.2);
      doc.setTextColor(
        reg.priority_tier === 'Critical' ? 185 : reg.priority_tier === 'High' ? 180 : 71,
        reg.priority_tier === 'Critical' ? 28 : reg.priority_tier === 'High' ? 83 : 85,
        reg.priority_tier === 'Critical' ? 28 : reg.priority_tier === 'High' ? 9 : 105
      );
      doc.text(reg.priority_tier, margin + 78, y + 4.2);
      doc.setTextColor(15, 23, 42);
      doc.text(String(reg.total_cases), margin + 126, y + 4.2, { align: 'right' });
      doc.text(formatZmw(reg.total_exposure_zmw), pageWidth - margin - 2.5, y + 4.2, {
        align: 'right',
      });
      y += 6;
    }
    y += 8;
  }

  // Top Performance Stations (Ranked by Validation Completion Rate)
  if (data.top_performing_stations && data.top_performing_stations.length > 0) {
    if (y > 220) {
      doc.addPage();
      y = 18;
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(15, 23, 42);
    doc.text('Top Performance — Station Validation Completion Ranking', margin, y);
    y += 4;

    doc.setFontSize(8);
    doc.setFillColor(241, 245, 249);
    doc.rect(margin, y, contentWidth, 6.5, 'F');
    doc.setTextColor(71, 85, 105);
    doc.text('Rank & Station', margin + 2.5, y + 4.4);
    doc.text('Verified', margin + 106, y + 4.4, { align: 'right' });
    doc.text('Return', margin + 136, y + 4.4, { align: 'right' });
    doc.text('Open Cases', margin + 160, y + 4.4, { align: 'right' });
    doc.text('Rate', pageWidth - margin - 2.5, y + 4.4, { align: 'right' });
    y += 6.5;

    doc.setFont('helvetica', 'normal');
    for (const stn of data.top_performing_stations) {
      doc.setDrawColor(226, 232, 240);
      doc.line(margin, y + 6, pageWidth - margin, y + 6);
      doc.setTextColor(15, 23, 42);
      doc.text(
        `#${stn.rank} ${stn.station_name.slice(0, 34)} (${stn.district})`,
        margin + 2.5,
        y + 4.2
      );
      doc.text(`${stn.verified_staff}/${stn.total_staff}`, margin + 106, y + 4.2, {
        align: 'right',
      });
      doc.text(stn.return_submitted ? 'Submitted' : 'Overdue', margin + 136, y + 4.2, {
        align: 'right',
      });
      doc.text(String(stn.open_cases), margin + 160, y + 4.2, { align: 'right' });
      doc.setTextColor(4, 120, 87);
      doc.text(`${stn.validation_completion_rate.toFixed(1)}%`, pageWidth - margin - 2.5, y + 4.2, {
        align: 'right',
      });
      y += 6;
    }
    y += 8;
  }

  // Strategic Recommendations & Implementation Summary (Table 5.1)
  if (y > 235) {
    doc.addPage();
    y = 18;
  }
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text('Summary of Deployment Recommendations & Governance Safeguards', margin, y);
  y += 5;

  const recs = [
    '1. Standardize Records: Enforce uniform Staff IDs across HR & PMEC and mandate monthly digital station returns.',
    '2. Scheduled Verifications: Conduct routine multi-level physical & digital checks at school, district, and national levels.',
    '3. Action Tracking: Assign every flagged mismatch a case number, independent reviewer, and deadline without stopping pay.',
    '4. Pilot Implementation: Validate control modules in selected pilot districts before national MPSA deployment.',
  ];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(51, 65, 85);
  for (const line of recs) {
    doc.text(line, margin + 1.5, y);
    y += 5;
  }

  // Footer
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p += 1) {
    doc.setPage(p);
    doc.setFontSize(7.5);
    doc.setTextColor(148, 163, 184);
    doc.text(
      `One Payroll Management System · Unified PMEC Control Layer · Page ${p} of ${totalPages}`,
      margin,
      287
    );
  }

  const fileName = `One_Payroll_Report_${dateRange.start_month}_to_${dateRange.end_month}.pdf`;
  doc.save(fileName);
  return fileName;
}
