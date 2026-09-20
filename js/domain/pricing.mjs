export function parseMoney(str) {
  if (!str) return null;
  const match = String(str)
    .replace(/,/g, "")
    .match(/\$\s*([0-9]+(?:\.[0-9]{1,2})?)/);

  return match ? parseFloat(match[1]) : null;
}

export function getNumericPrice(size, key) {
  if (size?.pricing && typeof size.pricing[key] === "number") {
    return size.pricing[key];
  }

  const fallbackMap = {
    msrp: "msrp",
    box10: "keystoneBox10",
    box20: "keystoneBox20",
    bundle20: "keystoneBundle20"
  };

  const oldField = fallbackMap[key];

  return oldField ? parseMoney(size?.[oldField]) : null;
}

export function getSinglePrice(size, type) {
  if (size?.pricing) {
    if (
      type === "box" &&
      typeof size.pricing.boxSingle === "number"
    ) {
      return size.pricing.boxSingle;
    }

    if (
      type === "bundle" &&
      typeof size.pricing.bundleSingle === "number"
    ) {
      return size.pricing.bundleSingle;
    }
  }

  const text = String(size?.keystoneSingle || "");

  if (type === "box") {
    const match = text.match(
      /\$\s*([0-9]+(?:\.[0-9]{1,2})?)\s*box/i
    );
    return match ? Number(match[1]) : null;
  }

  if (type === "bundle") {
    const match = text.match(
      /\$\s*([0-9]+(?:\.[0-9]{1,2})?)\s*bundle/i
    );
    return match ? Number(match[1]) : null;
  }

  return null;
}

export function computePackageMargins(size) {
  const msrp = getNumericPrice(size, "msrp");

  if (msrp == null || msrp <= 0) return null;

  const packages = [];

  const box10 = getNumericPrice(size, "box10");

  if (box10 != null && box10 > 0) {
    const retailValue = msrp * 10;
    const grossProfit = retailValue - box10;

    packages.push({
      key: "box10",
      label: "10ct Box",
      cost: box10,
      retailValue,
      grossProfit,
      marginPct: (grossProfit / retailValue) * 100,
      perStickCost: box10 / 10,
      perStickProfit: msrp - box10 / 10
    });
  }

  const box20 = getNumericPrice(size, "box20");

  if (box20 != null && box20 > 0) {
    const retailValue = msrp * 20;
    const grossProfit = retailValue - box20;

    packages.push({
      key: "box20",
      label: "20ct Box",
      cost: box20,
      retailValue,
      grossProfit,
      marginPct: (grossProfit / retailValue) * 100,
      perStickCost: box20 / 20,
      perStickProfit: msrp - box20 / 20
    });
  }

  const bundle20 = getNumericPrice(size, "bundle20");

  if (bundle20 != null && bundle20 > 0) {
    const retailValue = msrp * 20;
    const grossProfit = retailValue - bundle20;

    packages.push({
      key: "bundle20",
      label: "20ct Bundle",
      cost: bundle20,
      retailValue,
      grossProfit,
      marginPct: (grossProfit / retailValue) * 100,
      perStickCost: bundle20 / 20,
      perStickProfit: msrp - bundle20 / 20
    });
  }

  return packages.length ? packages : null;
}
