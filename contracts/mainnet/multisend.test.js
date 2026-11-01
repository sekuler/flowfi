const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("FlowFiMultiSend", function () {
  let ms, token, owner, a, b, c, attacker;
  beforeEach(async () => {
    [owner, a, b, c, attacker] = await ethers.getSigners();
    ms = await (await ethers.getContractFactory("FlowFiMultiSend")).deploy();
    token = await (await ethers.getContractFactory("TestToken")).deploy(6);
    await token.mint(owner.address, 1_000_000n);
  });

  it("sends to many recipients and emits event", async () => {
    await token.approve(await ms.getAddress(), 600n);
    await expect(ms.multiSend(await token.getAddress(), [a.address, b.address, c.address], [100n, 200n, 300n]))
      .to.emit(ms, "MultiSent").withArgs(owner.address, await token.getAddress(), 3, 600n);
    expect(await token.balanceOf(a.address)).to.equal(100n);
    expect(await token.balanceOf(b.address)).to.equal(200n);
    expect(await token.balanceOf(c.address)).to.equal(300n);
    expect(await token.balanceOf(owner.address)).to.equal(1_000_000n - 600n);
  });

  it("never holds funds and leaves no leftover allowance with exact approval", async () => {
    await token.approve(await ms.getAddress(), 300n);
    await ms.multiSend(await token.getAddress(), [a.address, b.address], [100n, 200n]);
    expect(await token.balanceOf(await ms.getAddress())).to.equal(0n);
    expect(await token.allowance(owner.address, await ms.getAddress())).to.equal(0n);
  });

  it("cannot move another user's tokens even if they approved the contract", async () => {
    await token.approve(await ms.getAddress(), 1_000_000n); // owner approves a lot
    // attacker tries to send owner's tokens: contract only pulls from msg.sender (attacker has 0)
    await expect(ms.connect(attacker).multiSend(await token.getAddress(), [attacker.address], [1000n])).to.be.reverted;
    expect(await token.balanceOf(attacker.address)).to.equal(0n);
    expect(await token.balanceOf(owner.address)).to.equal(1_000_000n);
  });

  it("reverts atomically if allowance is insufficient (nobody gets paid)", async () => {
    await token.approve(await ms.getAddress(), 250n);
    await expect(ms.multiSend(await token.getAddress(), [a.address, b.address], [100n, 200n])).to.be.reverted;
    expect(await token.balanceOf(a.address)).to.equal(0n);
  });

  it("reverts on bad input", async () => {
    const t = await token.getAddress();
    await token.approve(await ms.getAddress(), 1000n);
    await expect(ms.multiSend(t, [], [])).to.be.revertedWithCustomError(ms, "EmptyBatch");
    await expect(ms.multiSend(t, [a.address], [1n, 2n])).to.be.revertedWithCustomError(ms, "LengthMismatch");
    await expect(ms.multiSend(t, [ethers.ZeroAddress], [1n])).to.be.revertedWithCustomError(ms, "ZeroAddress");
    await expect(ms.multiSend(t, [a.address], [0n])).to.be.revertedWithCustomError(ms, "ZeroAmount");
    const many = Array(201).fill(a.address), amts = Array(201).fill(1n);
    await expect(ms.multiSend(t, many, amts)).to.be.revertedWithCustomError(ms, "TooManyRecipients");
  });

  it("handles 200 recipients and reports gas", async () => {
    const addrs = Array.from({ length: 200 }, (_, i) => ethers.getAddress("0x" + (i + 1).toString(16).padStart(40, "0")));
    const amts = Array(200).fill(5n);
    await token.approve(await ms.getAddress(), 1000n);
    const tx = await ms.multiSend(await token.getAddress(), addrs, amts);
    const r = await tx.wait();
    console.log("      gas for 200 recipients:", r.gasUsed.toString());
    expect(await token.balanceOf(addrs[199])).to.equal(5n);
  });

  it("rejects tokens that return false (SafeERC20)", async () => {
    const ft = await (await ethers.getContractFactory("FalseToken")).deploy();
    await ft.mint(owner.address, 100n);
    await ft.approve(await ms.getAddress(), 100n);
    await expect(ms.multiSend(await ft.getAddress(), [a.address], [10n])).to.be.reverted;
  });

  it("rejects plain native transfers (no payable/receive)", async () => {
    await expect(owner.sendTransaction({ to: await ms.getAddress(), value: 1n })).to.be.reverted;
  });

  it("has no owner/admin functions", async () => {
    const fns = ms.interface.fragments.filter(f => f.type === "function").map(f => f.name).sort();
    expect(fns).to.deep.equal(["MAX_RECIPIENTS", "multiSend"]);
  });
});
