import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export const downloadSubmissionPDF = async (previewId) => {
  const element = document.getElementById(previewId);

  if (!element) {
    console.error("Preview element not found:", previewId);
    return;
  }

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
  });

  const imgData = canvas.toDataURL("image/png");
  const pdf = new jsPDF("p", "mm", "a4");

  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

  pdf.addImage(imgData, "PNG", 0, 0, pdfWidth, pdfHeight);
  pdf.save(`submission-${previewId}.pdf`);
};
