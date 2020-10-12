const ethers = require('ethers');
const { Wallet, Contract } = ethers;


function WebWallet(wallet, encryptedJsonWallet) {
  const ERC20_ABI = [
    'function balanceOf(address owner) view returns (uint)',
    'function transfer(address to, uint256 amount)',
    'event Transfer(address indexed from, address indexed to, uint256 amount)'
  ];

  this.wallet = null;
  this.isLocked = true;
  this.tokens = [];
  this.provider = null;
  this.transactionNonce = null;
  this.network = '';
  this.encryptedJsonWallet = encryptedJsonWallet || '';

  /**
   * @description init wallet
   * @param {signer}
   * */
  const initWallet = (signer) => {
    if (!signer || !signer instanceof ethers.Signer || !ethers.Signer.isSigner(signer))
      throw new Error('Signer cannot be empty! Signer should be an instance of ethers.Signer!');
    this.wallet = signer;
    this.isLocked = false;
  }

  /**
   * @description create erc20 token contract
   * @param signer
   * @param address
   * @returns {Contract}
   * */
  const createERC20TokenContract = (signer, address) => {
    if (!signer || !signer.provider)
      throw new Error('There is no signer or network provider!');
    return new ethers.Contract(address, ERC20_ABI, signer);
  }

  /**
   * @description connect network & setting provider
   * @param network
   * */
  const connect = (network='homestead') => {
    if (!this.wallet)
      throw new Error('Wallet is null! You cannot connect to the network without a wallet!');

    this.provider = ethers.getDefaultProvider(network);
    this.network = network;
    this.wallet = this.wallet.connect(this.provider);
  }

  /**
   * @description add token to wallet
   * @param symbol
   * @param token contract address
   * */
  const addToken = async (symbol, address) => {
    if (this.isLocked)
      throw new Error('Wallet is locked!');

    if (this.tokens.find(token => token.address === address))
      return;

    const contract = createERC20TokenContract(this.wallet, address);
    const decimals = await contract.decimals();
    const oneToken = ethers.BigNumber.from('10').pow(decimals);


    this.tokens.push({
      symbol,
      address,
      decimals,
      oneToken,
      contract
    })
  }

  /**
   * @description Encrypt the wallet using password returning a Promise which resolves to a JSON wallet.
   * @param password
   * */
  const lock = async (password) => {
    if (!this.encryptedJsonWallet) {
      this.encryptedJsonWallet = await this.wallet.encrypt(password);
    }
    this.wallet = null;
    this.isLocked = true;
    this.provider = null;
    this.tokens = [];
    this.network = '';

    return this.encryptedJsonWallet;
  }

  /**
   * @description Decrypt the wallet using password returning a Promise which resolves to a wallet instance.
   * @param password
   * */
  const unlock = async (password) => {
    const wallet = await Wallet.fromEncryptedJson(this.encryptedJsonWallet, password);
    initWallet(wallet);
  }

  const isLocked = _ => {
    return this.isLocked;
  }

  const setNonce = async () => {
    this.transactionNonce = await this.wallet.getTransactionCount()
  }

  const getAddress = _ => {
    if (this.isLocked)
      throw new Error('Wallet is locked!');
    return this.wallet.address;
  }

  const getProvider = _ => {
    return this.provider;
  }

  const getNetwork = _ => {
    return this.network;
  }

  const getPrivateKey = _ => {
    if (this.isLocked)
      throw new Error('Wallet is locked!');
    return this.wallet.privateKey;
  }

  const getMnemonics = _ => {
    if (this.isLocked)
      throw new Error('Wallet is locked!');
    return this.wallet.mnemonic;
  }

  /**
   * @description get ether balance
   * @return ether balance
   */
  const getEtherBalance = async _ => {
    if (this.isLocked)
      throw new Error('Wallet is locked!');

    const wei = await this.wallet.getBalance();
    return ethers.utils.formatEther(wei);
  }

  /**
   * @description get token balance
   * @param token address
   * @returns token balance
   * */
  const getTokenBalance = async tokenAddress => {
    if (this.isLocked)
      return Promise.reject(new Error('Wallet is locked!'));
    const token = this.tokens.find(token => token.address === tokenAddress);
    if (!token)
      return Promise.reject(new Error('Token does now exist!'));

    const balance = await token.contract.balanceOf(this.wallet.address);

    // tokenSupply = tokensIActuallyWant * (10 ^ decimals)
    return balance.div(token.oneToken).toNumber();
  }

  /**
   * @description get ether history
   * @param network
   * @param address
   * @param start
   * @param end
   * @return ether history
   * */
  const getEtherHistory = async (network = this.network, address = this.wallet.address, start = 0, end = 'latest' ) => {
    const etherScanProvider = new ethers.providers.EtherscanProvider(network)
    const historyList = await etherScanProvider.getHistory(address, start, end)
    return historyList.map(data => ({
      transactionHash: data.hash,
      status: (data.from === address && data.to === address) ? 'SELF' : ((data.from === address) ? 'OUT' : 'IN'),
      from: data.from,
      to: data.to,
      amount: ethers.utils.formatEther(data.value),
      timestamp: data.timestamp
    }))
  }

  /**
   * @description get token history
   * @param tokenAddress
   * @return token history
   * */
  const getTokenHistory = async tokenAddress => {
    if (this.isLocked)
      return Promise.reject(new Error('Wallet is locked!'));
    const token = this.tokens.find(token => token.address === tokenAddress);
    if (!token)
      return Promise.reject(new Error('Token does now exist!'));

    const historyList = await token.contract.queryFilter('Transfer')
    return historyList
      .filter(data => data.args.some(address => address === this.wallet.address))
      .map(data => ({
        transactionHash: data.transactionHash,
        status: (data.args.from === this.wallet.address && data.args.to === this.wallet.address) ? 'SELF' : (data.args.from === this.wallet.address ? 'OUT' : 'IN'),
        from: data.args.from,
        to: data.args.to,
        amount: ethers.BigNumber.from(data.args[2]).div(ethers.BigNumber.from('10').pow(18)).toString()
      }))
  }

  const sendEther = async (to, amount, gas, transactionSpeed = 'average') => {
    try {
      ethers.utils.getAddress(to)
    } catch (e) {
      return Promise.reject(new Error('Invalid Ethereum address'))
    }

    const tx = await this.wallet.sendTransaction({
      nonce: this.transactionNonce++,
      to,
      value: ethers.utils.parseEther(amount),
      gasPrice: ethers.utils.parseUnits(gas, 'gwei').toHexString()
    })

    return tx;
  }

  const sendToken = async (tokenAddress, to, amount, gas, transactionSpeed = 'average') => {
    if (this.isLocked) { return Promise.reject(new Error('Wallet is locked!')) }

    const token = this.tokens.find(token => token.address === tokenAddress)

    if (!token) { return Promise.reject(new Error('Token does not exist!')) }

    try {
      ethers.utils.getAddress(to)
    } catch (e) {
      return Promise.reject(new Error('Invalid Ethereum address!'))
    }

    return (await token.contract.transfer(
      to,
      new ethers.BigNumber.from(amount).mul(token.oneToken).toString(),
      {
        gasPrice: ethers.utils.parseUnits(gas, 'gwei').toHexString(),
        nonce: this.transactionNonce++
      }
    ))
  }

  const removeToken = (address) => {
    if (this.isLocked)
      throw new Error('Wallet is locked!');

    if (!this.tokens.find(token => token.address === address))
      return;

    this.tokens = this.tokens.filter(token => token.address !== address);
  }

  initWallet(wallet)

  return Object.freeze({
    // init
    connect,
    addToken,
    setNonce,
    // lock & unlock
    lock,
    unlock,
    isLocked,
    // get
    getAddress,
    getProvider,
    getNetwork,
    getMnemonics,
    getPrivateKey,
    getEtherBalance,
    getTokenBalance,
    getEtherHistory,
    getTokenHistory,
    // send
    sendEther,
    sendToken,
    // remove
    removeToken

  })

}

/**@description create new wallet */
const createWallet = _ => new WebWallet(Wallet.createRandom());

const restoreWalletFromPrivateKey = privateKey => new WebWallet(new Wallet(privateKey));

const restoreWalletFromEncryptedJSON = json => new WebWallet(Wallet.fromEncryptedJsonSync(json, password))

const restoreWalletFromMnemonic = mnemonic => new WebWallet(Wallet.fromMnemonic(mnemonic))
