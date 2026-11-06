// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721CreatorCore} from "@manifoldxyz/creator-core-solidity/contracts/core/IERC721CreatorCore.sol";
import {CreatorExtension} from "@manifoldxyz/creator-core-solidity/contracts/extensions/CreatorExtension.sol";
import {ICreatorExtensionTokenURI} from
    "@manifoldxyz/creator-core-solidity/contracts/extensions/ICreatorExtensionTokenURI.sol";
import {IERC721CreatorExtensionApproveTransfer} from
    "@manifoldxyz/creator-core-solidity/contracts/extensions/ERC721/IERC721CreatorExtensionApproveTransfer.sol";
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";
import {EIP712} from "solady/utils/EIP712.sol";
import {LibString} from "solady/utils/LibString.sol";
import {SSTORE2} from "solady/utils/SSTORE2.sol";
import {IStripsRenderer, TokenView} from "./IStripsRenderer.sol";
import {StripsDesign} from "./StripsDesign.sol";
import {TaoLedger} from "./TaoLedger.sol";

interface IDelegateRegistry {
    function checkDelegateForERC721(address to, address from, address contract_, uint256 tokenId, bytes32 rights)
        external
        view
        returns (bool);
}

/// @title StripsExtension
/// @notice The //STRIPS rules, on a Manifold Creator Core that owns the tokens:
///         who may mint, what each token stores, its random word, its TAO
///         clock, which view it shows, its stories and its redemption.
contract StripsExtension is
    CreatorExtension,
    ICreatorExtensionTokenURI,
    IERC721CreatorExtensionApproveTransfer,
    VRFConsumerBaseV2Plus,
    EIP712,
    ReentrancyGuard
{
    uint256 public constant PRICE = 0.009 ether;
    uint256 public constant STREET_CAP = 69;
    uint256 public constant PUBLIC_CAP = 621;

    /// @notice TAO in tenths, per day.
    uint256 public constant RATE_HELD = 42;
    uint256 public constant RATE_REDEEMED = 690;

    uint256 public constant STORY_MAX = 280;

    /// @dev A vault can scope its delegation to this label, as it can for the COMBO.
    bytes32 private constant RIGHTS = bytes32("mintface");

    bytes32 private constant VOUCHER_TYPEHASH =
        keccak256("Voucher(address to,bytes32 designHash,uint256 nonce,uint256 deadline)");

    /// @notice Signed by the site to say a design came from the Maker. It can't
    ///         mint on its own and it can't set a price. The nonce isn't tracked:
    ///         the design it names can only ever be minted once.
    struct Voucher {
        address to;
        bytes32 designHash;
        uint256 nonce;
        uint256 deadline;
    }

    struct Token {
        address design; // where the packed design is stored
        uint40 mintedAt;
        uint40 heldSince;
        uint8 viewIndex;
    }

    struct Street {
        uint16 no;
        string site;
    }

    /// @notice The flat crop the app uses as an image target, and the size installed.
    struct ArTarget {
        string uri;
        uint16 widthCm;
        uint16 heightCm;
    }

    struct VrfConfig {
        bytes32 keyHash;
        uint256 subId;
        uint16 confirmations;
        uint32 callbackGas;
        bool native;
    }

    IERC721CreatorCore public immutable core;
    TaoLedger public immutable ledger;
    IDelegateRegistry public immutable delegates;
    address public immutable estate;

    IStripsRenderer public renderer;
    bool public rendererFrozen;
    address payable public payout;
    address public voucherSigner;
    bool public mintOpen;
    VrfConfig public vrf;

    uint256 public streetMinted;
    uint256 public publicMinted;
    uint256 public lastId;

    mapping(uint256 => Token) private _tokens;
    mapping(uint256 => uint256) public seedOf;
    mapping(uint256 => uint256) public redeemedAt;
    mapping(uint256 => string[]) private _photos;
    mapping(uint256 => Street) private _street;
    mapping(uint256 => ArTarget) private _arTarget;
    mapping(bytes32 => bool) public designUsed;
    mapping(uint256 => uint256) public requestToken;

    event Minted(uint256 indexed id, address indexed to, bytes32 indexed designHash, uint256 requestId, bool free);
    event StreetMinted(uint256 indexed id, uint16 indexed no, string site);
    event Seeded(uint256 indexed id, uint256 indexed requestId, uint256 word);
    event ViewChanged(uint256 indexed id, uint8 viewIndex);
    event PhotoAdded(uint256 indexed id, uint256 viewIndex, string uri);
    event ArTargetSet(uint256 indexed id, string uri, uint16 widthCm, uint16 heightCm);
    event Story(uint256 indexed id, address indexed author, string text);
    event CreatorStory(uint256 indexed id, string text);
    event Redeemed(uint256 indexed id, uint256 viewIndex);
    event RendererChanged(address renderer);
    event RendererFrozen(address renderer);
    event MintOpenChanged(bool open);
    event PayoutChanged(address payout);
    event VoucherSignerChanged(address signer);

    error NotCore();
    error MintClosed();
    error WrongPrice();
    error WrongWallet();
    error VoucherExpired();
    error BadVoucher();
    error DesignTaken();
    error PublicSoldOut();
    error StreetFull();
    error NoSuchToken();
    error NotHolder();
    error NoSuchView();
    error StoryTooLong();
    error AlreadyRedeemed();
    error StreetWork();
    error NotStreetWork();
    error AlreadySeeded();
    error Frozen();
    error PayoutFailed();

    constructor(
        address core_,
        TaoLedger ledger_,
        IDelegateRegistry delegates_,
        address estate_,
        address payable payout_,
        address voucherSigner_,
        IStripsRenderer renderer_,
        address vrfCoordinator_,
        VrfConfig memory vrf_
    ) VRFConsumerBaseV2Plus(vrfCoordinator_) {
        core = IERC721CreatorCore(core_);
        ledger = ledger_;
        delegates = delegates_;
        estate = estate_;
        payout = payout_;
        voucherSigner = voucherSigner_;
        renderer = renderer_;
        vrf = vrf_;
    }

    /* ---------- minting ---------- */

    /// @notice Mint at the price, to the wallet the voucher names.
    function mint(bytes calldata design, Voucher calldata v, bytes calldata sig)
        external
        payable
        nonReentrant
        returns (uint256 id)
    {
        if (msg.value != PRICE) revert WrongPrice();
        _checkVoucher(design, v, sig);
        id = _mintPublic(v.to, design, false);
        (bool ok,) = payout.call{value: msg.value}("");
        if (!ok) revert PayoutFailed();
    }

    /// @notice Mint with a free mint from the snapshot. taoTotal is part of the
    ///         row the proof covers.
    function mintFree(
        bytes calldata design,
        Voucher calldata v,
        bytes calldata sig,
        uint256 taoTotal,
        uint256 freeMints,
        bytes32[] calldata proof
    ) external nonReentrant returns (uint256 id) {
        if (msg.sender != v.to) revert WrongWallet();
        _checkVoucher(design, v, sig);
        ledger.claim(msg.sender, taoTotal, freeMints, proof);
        id = _mintPublic(msg.sender, design, true);
    }

    /// @notice A commission's free twin, from the public allowance, to its buyer.
    function mintTwin(bytes calldata design, address to) external onlyOwner nonReentrant returns (uint256 id) {
        id = _mintPublic(to, design, true);
    }

    /// @notice A street work, to the estate.
    function mintStreet(bytes calldata design, uint16 no, string calldata site)
        external
        onlyOwner
        nonReentrant
        returns (uint256 id)
    {
        if (streetMinted >= STREET_CAP) revert StreetFull();
        if (no == 0) revert NotStreetWork();
        ++streetMinted;
        id = _mint(estate, design, true);
        _street[id] = Street(no, site);
        emit StreetMinted(id, no, site);
    }

    function _checkVoucher(bytes calldata design, Voucher calldata v, bytes calldata sig) private view {
        if (!mintOpen) revert MintClosed();
        if (block.timestamp > v.deadline) revert VoucherExpired();
        if (v.designHash != keccak256(design)) revert BadVoucher();
        bytes32 digest =
            _hashTypedData(keccak256(abi.encode(VOUCHER_TYPEHASH, v.to, v.designHash, v.nonce, v.deadline)));
        if (ECDSA.recoverCalldata(digest, sig) != voucherSigner) revert BadVoucher();
    }

    function _mintPublic(address to, bytes calldata design, bool free) private returns (uint256) {
        if (publicMinted >= PUBLIC_CAP) revert PublicSoldOut();
        ++publicMinted;
        return _mint(to, design, free);
    }

    function _mint(address to, bytes calldata design, bool free) private returns (uint256 id) {
        StripsDesign.read(design);
        bytes32 hash = keccak256(design);
        if (designUsed[hash]) revert DesignTaken();
        designUsed[hash] = true;
        address stored = SSTORE2.write(design);

        /* A mint isn't a transfer, so the core won't call approveTransfer for
           it and the clock has to start here. */
        id = core.mintExtension(to);
        _tokens[id] = Token(stored, uint40(block.timestamp), uint40(block.timestamp), 0);
        if (id > lastId) lastId = id;

        uint256 requestId = _requestSeed(id);
        emit Minted(id, to, hash, requestId, free);
    }

    /* ---------- the random word ---------- */

    function _requestSeed(uint256 id) private returns (uint256 requestId) {
        VrfConfig memory c = vrf;
        requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash: c.keyHash,
                subId: c.subId,
                requestConfirmations: c.confirmations,
                callbackGasLimit: c.callbackGas,
                numWords: 1,
                extraArgs: VRFV2PlusClient._argsToBytes(VRFV2PlusClient.ExtraArgsV1({nativePayment: c.native}))
            })
        );
        requestToken[requestId] = id;
    }

    /// @notice Ask again for a token whose request never came back, which is
    ///         what happens if the subscription ran dry. A word that has
    ///         landed can never be replaced, so this can't re-roll anything.
    function retrySeed(uint256 id) external onlyOwner returns (uint256 requestId) {
        if (_tokens[id].mintedAt == 0) revert NoSuchToken();
        if (seedOf[id] != 0) revert AlreadySeeded();
        requestId = _requestSeed(id);
    }

    function fulfillRandomWords(uint256 requestId, uint256[] calldata words) internal override {
        uint256 id = requestToken[requestId];
        if (id == 0 || seedOf[id] != 0) return;
        seedOf[id] = words[0];
        emit Seeded(id, requestId, words[0]);
    }

    /* ---------- the TAO clock ---------- */

    /// @inheritdoc IERC721CreatorExtensionApproveTransfer
    function setApproveTransfer(address creator, bool enabled) external override onlyOwner {
        if (creator != address(core)) revert NotCore();
        core.setApproveTransferExtension(enabled);
    }

    /// @inheritdoc IERC721CreatorExtensionApproveTransfer
    function approveTransfer(address, address, address, uint256 id) external override returns (bool) {
        if (msg.sender != address(core)) revert NotCore();
        _tokens[id].heldSince = uint40(block.timestamp);
        return true;
    }

    /// @notice This token's TAO under its current holder, in tenths.
    function taoOf(uint256 id) public view returns (uint256) {
        uint256 since = _tokens[id].heldSince;
        if (since == 0) revert NoSuchToken();
        uint256 redeemed = redeemedAt[id];
        if (redeemed == 0) return (block.timestamp - since) * RATE_HELD / 1 days;
        if (since >= redeemed) return (block.timestamp - since) * RATE_REDEEMED / 1 days;
        return ((redeemed - since) * RATE_HELD + (block.timestamp - redeemed) * RATE_REDEEMED) / 1 days;
    }

    /// @notice Every //STRIPS token this wallet holds, added up, in tenths. A
    ///         view that walks the whole collection, not for use in a transaction.
    function taoOfOwner(address wallet) external view returns (uint256 total) {
        uint256 last = lastId;
        for (uint256 id = 1; id <= last; ++id) {
            if (_tokens[id].mintedAt == 0) continue;
            try IERC721(address(core)).ownerOf(id) returns (address holder) {
                if (holder == wallet) total += taoOf(id);
            } catch {} // burned
        }
    }

    /* ---------- what the holder does ---------- */

    function _onlyHolder(uint256 id) private view {
        address holder = IERC721(address(core)).ownerOf(id);
        if (msg.sender == holder) return;
        if (!delegates.checkDelegateForERC721(msg.sender, holder, address(core), id, RIGHTS)) revert NotHolder();
    }

    /// @notice Which entry the token shows: 0 animated, 1 still, 2 and up a photo.
    function setView(uint256 id, uint8 n) external {
        _onlyHolder(id);
        if (n > 1 + _photos[id].length) revert NoSuchView();
        _tokens[id].viewIndex = n;
        emit ViewChanged(id, n);
    }

    /// @notice A short story on a token, kept in the event log.
    function tellStory(uint256 id, string calldata text) external {
        _onlyHolder(id);
        if (LibString.runeCount(text) > STORY_MAX) revert StoryTooLong();
        emit Story(id, msg.sender, text);
    }

    /* ---------- what Ryan signs in /mintwork ---------- */

    function addPhoto(uint256 id, string calldata uri) public onlyOwner {
        if (_tokens[id].mintedAt == 0) revert NoSuchToken();
        _photos[id].push(uri);
        emit PhotoAdded(id, 1 + _photos[id].length, uri);
    }

    function setArTarget(uint256 id, string calldata uri, uint16 widthCm, uint16 heightCm) external onlyOwner {
        if (_street[id].no == 0) revert NotStreetWork();
        _arTarget[id] = ArTarget(uri, widthCm, heightCm);
        emit ArTargetSet(id, uri, widthCm, heightCm);
    }

    function addCreatorStory(uint256 id, string calldata text) external onlyOwner {
        if (_tokens[id].mintedAt == 0) revert NoSuchToken();
        emit CreatorStory(id, text);
    }

    /// @notice The token has become a painting. One time, for good.
    function redeem(uint256 id, string calldata photoUri) external onlyOwner {
        if (redeemedAt[id] != 0) revert AlreadyRedeemed();
        if (_street[id].no != 0) revert StreetWork();
        addPhoto(id, photoUri);
        redeemedAt[id] = block.timestamp;
        StripsDesign.Shape memory s = StripsDesign.read(SSTORE2.read(_tokens[id].design));
        emit Redeemed(id, 1 + _photos[id].length);
        emit CreatorStory(
            id,
            string.concat(
                LibString.toString(s.length), " x ", LibString.toString(s.width), " cm, painted by MintFace"
            )
        );
    }

    function setMintOpen(bool open) external onlyOwner {
        mintOpen = open;
        emit MintOpenChanged(open);
    }

    function setPayout(address payable payout_) external onlyOwner {
        payout = payout_;
        emit PayoutChanged(payout_);
    }

    function setVoucherSigner(address signer) external onlyOwner {
        voucherSigner = signer;
        emit VoucherSignerChanged(signer);
    }

    function setVrf(VrfConfig calldata c) external onlyOwner {
        vrf = c;
    }

    function setRenderer(IStripsRenderer renderer_) external onlyOwner {
        if (rendererFrozen) revert Frozen();
        renderer = renderer_;
        emit RendererChanged(address(renderer_));
    }

    /// @notice Permanent. After this the art can never change.
    function freezeRenderer() external onlyOwner {
        rendererFrozen = true;
        emit RendererFrozen(address(renderer));
    }

    /* ---------- reading ---------- */

    /// @inheritdoc ICreatorExtensionTokenURI
    function tokenURI(address creator, uint256 id) external view override returns (string memory) {
        if (creator != address(core)) revert NotCore();
        Token memory t = _tokens[id];
        if (t.mintedAt == 0) revert NoSuchToken();
        Street storage st = _street[id];
        return renderer.render(
            TokenView({
                id: id,
                design: SSTORE2.read(t.design),
                word: seedOf[id],
                mintedAt: t.mintedAt,
                viewIndex: t.viewIndex,
                redeemed: redeemedAt[id] != 0,
                photo: t.viewIndex >= 2 ? _photos[id][t.viewIndex - 2] : "",
                no: st.no,
                site: st.site
            })
        );
    }

    function designOf(uint256 id) external view returns (bytes memory) {
        if (_tokens[id].mintedAt == 0) revert NoSuchToken();
        return SSTORE2.read(_tokens[id].design);
    }

    function tokenOf(uint256 id) external view returns (Token memory) {
        return _tokens[id];
    }

    function photosOf(uint256 id) external view returns (string[] memory) {
        return _photos[id];
    }

    function streetOf(uint256 id) external view returns (Street memory) {
        return _street[id];
    }

    function arTargetOf(uint256 id) external view returns (ArTarget memory) {
        return _arTarget[id];
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(CreatorExtension, IERC165)
        returns (bool)
    {
        return interfaceId == type(ICreatorExtensionTokenURI).interfaceId
            || interfaceId == type(IERC721CreatorExtensionApproveTransfer).interfaceId
            || CreatorExtension.supportsInterface(interfaceId);
    }

    function _domainNameAndVersion() internal pure override returns (string memory, string memory) {
        return ("//STRIPS", "1");
    }
}
