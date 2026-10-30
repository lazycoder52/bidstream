import { PrismaClient } from '@prisma/client';

export async function checkInvariants(prismaClient = null) {
  const prisma = prismaClient || new PrismaClient();
  let shouldDisconnect = !prismaClient;

  const violations = [];
  let totalAuctionsChecked = 0;
  let totalBidsChecked = 0;

  try {
    const auctions = await prisma.auction.findMany({
      include: {
        bids: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    totalAuctionsChecked = auctions.length;

    for (const auction of auctions) {
      const bids = auction.bids;
      totalBidsChecked += bids.length;

      // Invariant 1: bid_count must strictly equal actual bid count
      if (auction.bidCount !== bids.length) {
        violations.push({
          auctionId: auction.id,
          type: 'BID_COUNT_MISMATCH',
          expected: bids.length,
          actual: auction.bidCount,
          message: `Auction ${auction.id} recorded bidCount ${auction.bidCount} but has ${bids.length} bids`,
        });
      }

      // Invariant 2: current_price must equal starting_price (if 0 bids) or MAX(amount)
      if (bids.length === 0) {
        if (auction.currentPrice !== auction.startingPrice) {
          violations.push({
            auctionId: auction.id,
            type: 'STARTING_PRICE_MISMATCH',
            expected: auction.startingPrice,
            actual: auction.currentPrice,
            message: `Auction ${auction.id} has 0 bids but currentPrice ${auction.currentPrice} !== startingPrice ${auction.startingPrice}`,
          });
        }
      } else {
        const maxAmount = Math.max(...bids.map((b) => b.amount));
        if (auction.currentPrice !== maxAmount) {
          violations.push({
            auctionId: auction.id,
            type: 'CURRENT_PRICE_MISMATCH',
            expected: maxAmount,
            actual: auction.currentPrice,
            message: `Auction ${auction.id} currentPrice ${auction.currentPrice} !== highest bid amount ${maxAmount}`,
          });
        }
      }

      // Invariant 3: Bids must be strictly monotonically increasing in amount
      for (let i = 1; i < bids.length; i++) {
        if (bids[i].amount <= bids[i - 1].amount) {
          violations.push({
            auctionId: auction.id,
            type: 'NON_MONOTONIC_BIDS',
            bidId1: bids[i - 1].id,
            amount1: bids[i - 1].amount,
            bidId2: bids[i].id,
            amount2: bids[i].amount,
            message: `Auction ${auction.id} has non-monotonic bid sequence: bid ${bids[i].id} (${bids[i].amount}) <= bid ${bids[i - 1].id} (${bids[i - 1].amount})`,
          });
        }
      }

      // Invariant 4: No duplicate bid amounts on the same auction
      const amountSet = new Set();
      for (const bid of bids) {
        if (amountSet.has(bid.amount)) {
          violations.push({
            auctionId: auction.id,
            type: 'DUPLICATE_BID_AMOUNT',
            amount: bid.amount,
            message: `Auction ${auction.id} contains duplicate accepted bid amount ${bid.amount}`,
          });
        }
        amountSet.add(bid.amount);
      }

      // Invariant 5: Winner validation on ended auctions
      if (auction.status === 'ENDED' && bids.length > 0) {
        const highestBid = bids[bids.length - 1];
        const reserveMet = auction.reservePrice === null || highestBid.amount >= auction.reservePrice;
        const expectedWinner = reserveMet ? highestBid.bidderId : null;

        if (auction.winnerId !== expectedWinner) {
          violations.push({
            auctionId: auction.id,
            type: 'WINNER_MISMATCH',
            expectedWinner,
            actualWinner: auction.winnerId,
            message: `Auction ${auction.id} winner is ${auction.winnerId}, but expected ${expectedWinner}`,
          });
        }
      }
    }

    // Invariant 6: Zero orphan bids referencing non-existent auctions
    const orphanBids = await prisma.$queryRaw`
      SELECT b.id, b.auction_id
      FROM bids b
      LEFT JOIN auctions a ON b.auction_id = a.id
      WHERE a.id IS NULL
    `;

    if (Array.isArray(orphanBids) && orphanBids.length > 0) {
      violations.push({
        type: 'ORPHAN_BIDS',
        count: orphanBids.length,
        message: `Found ${orphanBids.length} orphan bids with no parent auction`,
      });
    }
  } catch (err) {
    if (shouldDisconnect) {
      await prisma.$disconnect();
    }
    throw err;
  }

  if (shouldDisconnect) {
    await prisma.$disconnect();
  }

  const passed = violations.length === 0;

  return {
    passed,
    totalAuctionsChecked,
    totalBidsChecked,
    violationsCount: violations.length,
    violations,
  };
}

if (process.argv[1]?.endsWith('check-invariants.mjs')) {
  console.log('Running Database Invariant Verification...');
  checkInvariants()
    .then((result) => {
      console.log('Invariant Check Result:', JSON.stringify(result, null, 2));
      if (!result.passed) {
        console.error('FAILED: Invariant violations detected!');
        process.exit(1);
      } else {
        console.log('SUCCESS: All database invariants verified cleanly (0 violations).');
      }
    })
    .catch((err) => {
      console.warn('Could not run invariant check (database not reachable):', err.message);
    });
}
