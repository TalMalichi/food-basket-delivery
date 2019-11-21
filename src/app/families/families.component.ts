import { Component, OnInit, ViewChild, Input, ElementRef } from '@angular/core';
import { AndFilter, ColumnSetting, GridSettings } from '@remult/core';

import { Families } from './families';
import { DeliveryStatus } from "./DeliveryStatus";
import { CallStatus } from "./CallStatus";
import { YesNo } from "./YesNo";

import { FamilySources } from "./FamilySources";
import { BasketType } from "./BasketType";
import { SelectService } from '../select-popup/select-service';
import { DialogService } from '../select-popup/dialog';
import { GeocodeInformation, GetGeoInformation } from '../shared/googleApiHelpers';

import { DomSanitizer } from '@angular/platform-browser';

import { FilterBase } from '@remult/core';

import { BusyService } from '@remult/core';
import * as chart from 'chart.js';
import { Stats, FaimilyStatistics, colors } from './stats-action';
import { MatDialog, MatDialogConfig } from '@angular/material/dialog';
import { reuseComponentOnNavigationAndCallMeWhenNavigatingToIt, leaveComponent } from '../custom-reuse-controller-router-strategy';
import { HasAsyncGetTheValue, DateTimeColumn, PhoneColumn } from '../model-shared/types';
import { Helpers } from '../helpers/helpers';
import { Route } from '@angular/router';

import { Context } from '@remult/core';

import { FamilyDeliveries } from './FamilyDeliveries';
import { UpdateFamilyComponent } from '../update-family/update-family.component';
import { PortalHostDirective } from '@angular/cdk/portal';
import { saveToExcel } from '../shared/saveToExcel';
import { PreviewFamilyComponent, PreviewFamilyInfo } from '../preview-family/preview-family.component';
import { Roles, AdminGuard } from '../auth/roles';
import { MatTabGroup } from '@angular/material/tabs';
import { QuickAddFamilyComponent } from '../quick-add-family/quick-add-family.component';
import { ApplicationSettings } from '../manage/ApplicationSettings';
import { ScrollDispatcher, CdkScrollable } from '@angular/cdk/scrolling';
import { Subscription } from 'rxjs';
import { translate } from '../translate';

@Component({
    selector: 'app-families',
    templateUrl: './families.component.html',
    styleUrls: ['./families.component.scss']
})
export class FamiliesComponent implements OnInit {
    @Input() problemOnly = false;
    limit = 50;
    addressByGoogleColumn: ColumnSetting<Families>;
    familyNameColumn: ColumnSetting<Families>;
    familyAddressColumn: ColumnSetting<Families>;
    addressCommentColumn: ColumnSetting<Families>;
    groupsColumn: ColumnSetting<Families>;
    statusColumn: ColumnSetting<Families>;
    deliverySummary: ColumnSetting<Families>;
    scrollingSubscription: Subscription;
    showHoverButton: boolean = false;
    constructor(private dialog: DialogService, private san: DomSanitizer, public busy: BusyService, private context: Context, private selectService: SelectService, private matDialog: MatDialog,
        public scroll: ScrollDispatcher) {
        this.doTest();
        this.scrollingSubscription = this.scroll
            .scrolled()
            .subscribe((data: CdkScrollable) => {
                let val = this.testing.nativeElement.getBoundingClientRect().y < 0;
                if (val != this.showHoverButton)
                    this.dialog.zone.run(() => this.showHoverButton = val);

            });
        let y = dialog.refreshStatusStats.subscribe(() => {
            this.refreshStats();
        });
        this.onDestroy = () => {
            y.unsubscribe();
        };
        if (dialog.isScreenSmall())
            this.gridView = false;
    }
    @ViewChild("myRef", { static: true }) testing: ElementRef;
    filterBy(s: FaimilyStatistics) {
        this.families.get({
            where: s.rule,
            limit: this.limit,
            orderBy: f => [f.name]


        });
    }

    resetRow() {
        var focus: Families;
        if (this.families.currentRow.isNew()) {
            let i = this.families.items.indexOf(this.families.currentRow);
            if (i > 0)
                focus = this.families.items[i - 1];
        }
        this.families.currentRow.reset();
        if (focus)
            this.families.setCurrentRow(focus);
    }
    quickAdd() {
        QuickAddFamilyComponent.dialog(this.matDialog, {
            searchName: this.searchString,
            addedFamily: f => {
                this.families.items.push(f);
                this.families.setCurrentRow(f);
            }
        });
    }
    changedRowsCount() {
        let r = 0;
        this.families.items.forEach(f => {
            if (f.wasChanged())

                r++;
        });
        return r;
    }
    async saveAll() {
        this.families.items.forEach(f => {
            if (f.wasChanged())
                f.save();
        });
    }
    public pieChartLabels: string[] = [];
    public pieChartData: number[] = [];
    pieChartStatObjects: FaimilyStatistics[] = [];
    public colors: Array<any> = [
        {
            backgroundColor: []

        }];

    public pieChartType: string = 'pie';
    currentStatFilter: FaimilyStatistics = undefined;

    options: chart.ChartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        legend: {
            position: 'right',
            onClick: (event: MouseEvent, legendItem: any) => {
                this.setCurrentStat(this.pieChartStatObjects[legendItem.index]);
                return false;
            }
        },
    };
    public chartClicked(e: any): void {
        if (e.active && e.active.length > 0) {
            this.setCurrentStat(this.pieChartStatObjects[e.active[0]._index]);

        }
    }
    setCurrentStat(s: FaimilyStatistics) {
        this.currentStatFilter = s;
        this.refreshFamilyGrid();
    }
    searchString = '';
    async doSearch() {
        if (this.families.currentRow && this.families.currentRow.wasChanged())
            return;
        this.busy.donotWait(async () =>
            await this.refreshFamilyGrid());
    }
    async refreshFamilyGrid() {
        this.families.page = 1;
        await this.families.getRecords();
    }

    clearSearch() {
        this.searchString = '';
        this.doSearch();
    }
    stats = new Stats();
    async saveToExcel() {
        await saveToExcel<Families, GridSettings<Families>>(
            this.families,
            translate('משפחות'),
            this.busy,
            (f, c) => c == f.id || c == f.addressApiResult,
            (f, c) => c == f.correntAnErrorInStatus || c == f.visibleToCourier,
            (f, addColumn) => {
                let x = f.getGeocodeInformation();
                let street = f.address.value;
                let house = '';

                let lastName = '';
                let firstName = '';
                if (f.name.value != undefined)
                    lastName = f.name.value.trim();
                let i = lastName.lastIndexOf(' ');
                if (i >= 0) {
                    firstName = lastName.substring(i, lastName.length).trim();
                    lastName = lastName.substring(0, i).trim();
                }
                {
                    try {
                        for (const addressComponent of x.info.results[0].address_components) {
                            switch (addressComponent.types[0]) {
                                case "route":
                                    street = addressComponent.short_name;
                                    break;
                                case "street_number":
                                    house = addressComponent.short_name;
                                    break;
                            }
                        }
                    } catch{ }
                }
                addColumn("Xשם משפחה", lastName, 's');
                addColumn("Xשם פרטי", firstName, 's');
                addColumn("Xרחוב", street, 's');
                addColumn("Xמספר בית", house, 's');
                function fixPhone(p: PhoneColumn) {
                    if (!p.value)
                        return '';
                    else return p.value.replace(/\D/g, '')
                }
                addColumn("טלפון1X", fixPhone(f.phone1), 's');
                addColumn("טלפון2X", fixPhone(f.phone2), 's');

            });
    }



    currentFamilyDeliveries: FamilyDeliveries[] = [];
    async saveCurrentFamilies() {
        await this.families.currentRow.save();
        this.currentFamilyDeliveries = await this.families.currentRow.getDeliveries();
    }
    families = this.context.for(Families).gridSettings({

        allowUpdate: true,
        allowInsert: true,

        rowCssClass: f => f.deliverStatus.getCss(),
        numOfColumnsInGrid: 4,
        onEnterRow: async f => {
            if (f.isNew()) {
                f.basketType.value = '';
                f.deliverStatus.value = ApplicationSettings.get(this.context).defaultStatusType.value;
                f.special.value = YesNo.No;
                this.currentFamilyDeliveries = [];
            } else {
                if (!this.gridView) {
                    this.currentFamilyDeliveries = [];
                    this.busy.donotWait(async () => this.currentFamilyDeliveries = await this.families.currentRow.getDeliveries());
                }
            }
        },



        get: {
            limit: this.limit,
            where: f => {
                let index = 0;
                let result: FilterBase = undefined;
                let addFilter = (filter: FilterBase) => {
                    if (result)
                        result = new AndFilter(result, filter);
                    else result = filter;
                }

                if (this.currentStatFilter) {
                    addFilter(this.currentStatFilter.rule(f));
                } else {
                    if (this.myTab)
                        index = this.myTab.selectedIndex;
                    if (index < 0 || index == undefined)
                        index = 0;

                    addFilter(this.statTabs[index].rule(f));
                }
                if (this.searchString) {
                    addFilter(f.name.isContains(this.searchString));
                }
                if (this.problemOnly) {
                    addFilter(f.addressOk.isEqualTo(false));
                }
                return result;
            }
            , orderBy: f => f.name
        },
        hideDataArea: true,
        knowTotalRows: true,


        confirmDelete: (h, yes) => this.dialog.confirmDelete(translate('משפחת ') + h.name.value, yes),
        columnSettings: families => {
            let r = [

                this.familyNameColumn = {
                    column: families.name,
                    width: '200'
                },
                this.familyAddressColumn = {
                    column: families.address,
                    width: '250',
                    cssClass: f => {
                        if (!f.addressOk.value)
                            return 'addressProblem';
                        return '';
                    }
                },
                families.courier.getColumn(this.selectService),

                families.basketType.getColumn()
                ,
                this.statusColumn = families.deliverStatus.getColumn(),
                this.deliverySummary = {
                    caption: 'סיכום משלוח',
                    column: families.deliverStatus,
                    readonly: true,
                    dropDown: {
                        items: families.deliverStatus.getOptions()
                    },
                    getValue: f => f.getDeliveryDescription(),
                    width: '200'
                },

                {
                    column: families.familyMembers,

                },

                families.familySource.getColumn(),
                this.groupsColumn = families.groups.getColumn(this.selectService),
                {
                    column: families.internalComment,
                    width: '300'
                },
                families.tz,
                families.tz2,
                families.iDinExcel,
                families.deliveryComments,
                families.special.getColumn(),
                families.createUser,
                families.createDate,
                families.lastUpdateDate,

                families.addressOk,
                families.floor,
                families.appartment,
                families.entrance,
                this.addressCommentColumn = { column: families.addressComment },
                families.city,
                families.postalCode,
                this.addressByGoogleColumn = families.addressByGoogle(),
                {
                    caption: 'מה הבעיה של גוגל',
                    getValue: f => f.getGeocodeInformation().whyProblem()
                },
                families.phone1,
                families.phone1Description,
                families.phone2,
                families.phone2Description,
                families.courier.getColumn(this.selectService),
                families.fixedCourier.getColumn(this.selectService),
                {
                    caption: 'טלפון משנע',
                    getValue: f => this.context.for(Helpers).lookup(f.courier).phone.value
                },
                families.courierAssignUser,
                families.courierAssingTime,

                families.defaultSelfPickup,
                families.deliveryStatusUser,
                families.deliveryStatusDate,
                families.courierComments,
                families.getPreviousDeliveryColumn(),
                families.previousDeliveryComment,
                families.previousDeliveryDate,
                families.socialWorker,
                families.socialWorkerPhone1,
                families.socialWorkerPhone2,
                families.needsWork,
                families.needsWorkDate,
                families.needsWorkUser
            ];
            if (!DeliveryStatus.usingSelfPickupModule) {
                r = r.filter(x => x != families.defaultSelfPickup);
            }
            return r;
        },
        rowButtons: [
            {
                name: '',
                icon: 'edit',
                click: async f => {
                    this.gridView = !this.gridView;
                    if (!this.gridView) {
                        this.currentFamilyDeliveries = await f.getDeliveries()
                    }
                }
            },
            {
                name: 'חפש כתובת בגוגל',
                cssClass: 'btn btn-success',
                click: f => f.openGoogleMaps(),
                visible: f => this.problemOnly
            },
            {
                cssClass: 'btn btn-success',
                name: 'משלוח חדש',
                visible: f => f.deliverStatus.value != DeliveryStatus.ReadyForDelivery &&
                    f.deliverStatus.value != DeliveryStatus.SelfPickup &&
                    f.deliverStatus.value != DeliveryStatus.Frozen &&
                    f.deliverStatus.value != DeliveryStatus.RemovedFromList
                ,
                click: async f => {
                    await this.busy.donotWait(async () => {
                        f.setNewBasket();
                        await f.save();
                    });
                }
            }
        ]
    });

    gridView = true;


    async doTest() {
    }

    onDestroy = () => { };

    ngOnDestroy(): void {
        this.onDestroy();
        this.scrollingSubscription.unsubscribe();
    }
    basketStats: statsOnTab = {
        name: 'נותרו לפי סלים',
        rule: f => f.readyAndSelfPickup(),
        stats: [
            this.stats.ready,
            this.stats.special
        ],
        moreStats: [],
        fourthColumn: () => this.statusColumn
    };
    cityStats: statsOnTab = {
        name: 'נותרו לפי ערים',
        rule: f => f.readyFilter(),
        stats: [
            this.stats.ready,
            this.stats.special
        ],
        moreStats: [],
        fourthColumn: () => this.statusColumn
    };
    groupsReady: statsOnTab = {
        name: 'נותרו לפי קבוצות',
        rule: f => f.readyFilter(),
        stats: [
            this.stats.ready,
            this.stats.special
        ],
        moreStats: [],
        fourthColumn: () => this.groupsColumn
    };
    groupsTotals: statsOnTab = {
        name: translate('כל המשפחות לפי קבוצות'),
        rule: f => f.deliverStatus.isDifferentFrom(DeliveryStatus.RemovedFromList),
        stats: [
            this.stats.ready,
            this.stats.special
        ],
        moreStats: [],
        fourthColumn: () => this.groupsColumn
    };
    statTabs: statsOnTab[] = [
        {
            name: 'באירוע',
            rule: f => f.deliverStatus.isInEvent(),
            stats: [
                this.stats.ready,
                this.stats.special,
                this.stats.selfPickup,
                this.stats.frozen,
                this.stats.blocked,
                this.stats.onTheWay,
                this.stats.delivered,
                this.stats.problem

            ],
            moreStats: [],
            fourthColumn: () => this.statusColumn
        },
        this.cityStats,
        this.basketStats,
        this.groupsReady,

        {
            name: 'מצריך טיפול',
            rule: f => f.deliverStatus.isInEvent().and(f.needsWork.isEqualTo(true)),
            stats: [
                this.stats.needWork
            ],
            moreStats: [],
            fourthColumn: () => this.deliverySummary
        },
        {
            rule: f => undefined,
            name: translate('כל המשפחות'),
            stats: [
                this.stats.currentEvent,
                this.stats.notInEvent,
                this.stats.outOfList
            ],
            moreStats: [],
            fourthColumn: () => this.statusColumn
        },
        this.groupsTotals
    ]
    tabChanged() {
        this.currentStatFilter = undefined;
        let prevTabColumn = this.currentTabStats.fourthColumn();
        this.refreshFamilyGrid();
        this.updateChart();

        let cols = this.families.columns;
        let currentTabColumn = this.currentTabStats.fourthColumn();
        if (prevTabColumn != currentTabColumn && prevTabColumn == cols.items[3]) {

            let origIndex = cols.items.indexOf(currentTabColumn);
            cols.moveCol(currentTabColumn, -origIndex + 3);
        }


    }
    clearStat() {
        this.currentStatFilter = undefined;
        this.refreshFamilyGrid();

    }
    currentTabStats: statsOnTab = { name: '', stats: [], moreStats: [], rule: undefined, fourthColumn: () => this.statusColumn };
    previousTabStats: statsOnTab = this.currentTabStats;
    updateChart() {
        this.pieChartData = [];
        this.pieChartStatObjects = [];
        this.pieChartLabels.splice(0);
        this.colors[0].backgroundColor.splice(0);
        this.currentTabStats = this.statTabs[this.myTab.selectedIndex];
        let stats = this.currentTabStats.stats;

        stats.forEach(s => {
            if (s.value > 0) {
                this.pieChartLabels.push(s.name + ' ' + s.value);
                this.pieChartData.push(s.value);
                if (s.color != undefined)
                    this.colors[0].backgroundColor.push(s.color);
                this.pieChartStatObjects.push(s);

            }
        });
        if (this.pieChartData.length == 0) {
            this.pieChartData.push(0);
            this.pieChartLabels.push('ריק');
        }
        if (this.colors[0].backgroundColor.length == 0) {
            this.colors[0].backgroundColor.push(colors.green, colors.blue, colors.yellow, colors.red, colors.orange, colors.gray);
        }
    }
    totalBoxes1 = 0;
    blockedBoxes1 = 0;
    totalBoxes2 = 0;
    blockedBoxes2 = 0;

    refreshStats() {
        if (this.suspend)
            return;
        if (!this.problemOnly)
            this.busy.donotWait(async () => this.stats.getData().then(st => {
                this.basketStats.stats.splice(0);
                this.cityStats.stats.splice(0);
                this.cityStats.moreStats.splice(0);
                this.groupsReady.stats.splice(0);
                this.groupsTotals.stats.splice(0);

                this.totalBoxes1 = 0;
                this.blockedBoxes1 = 0;
                this.totalBoxes2 = 0;
                this.blockedBoxes2 = 0;
                st.baskets.forEach(b => {
                    let fs = new FaimilyStatistics(b.name, f => f.deliverStatus.isEqualTo(DeliveryStatus.ReadyForDelivery).and(f.courier.isEqualTo('').and(f.basketType.isEqualTo(b.id))), undefined);
                    fs.value = b.unassignedFamilies;
                    this.basketStats.stats.push(fs);
                    if (b.blocked) {
                        this.blockedBoxes1 += +b.boxes * +b.unassignedFamilies;
                        this.blockedBoxes2 += +b.boxes2 * +b.unassignedFamilies;
                    } else {
                        this.totalBoxes1 += +b.boxes * +b.unassignedFamilies;
                        this.totalBoxes2 += +b.boxes2 * +b.unassignedFamilies;
                    }

                });
                let i = 0;
                let lastFs: FaimilyStatistics;
                let firstCities = [];
                st.cities.forEach(b => {
                    let fs = new FaimilyStatistics(b.name, f => f.readyFilter().and(f.city.isEqualTo(b.name)), undefined);
                    fs.value = +b.count;

                    i++;

                    if (i <= 8) {
                        this.cityStats.stats.push(fs);
                        firstCities.push(b.name);
                    }
                    if (i > 8) {
                        if (!lastFs) {
                            let x = this.cityStats.stats.pop();
                            firstCities.pop();
                            lastFs = new FaimilyStatistics('כל השאר', f => {
                                let r = f.readyFilter().and(f.city.isDifferentFrom(firstCities[0]));
                                for (let index = 1; index < firstCities.length; index++) {
                                    r = r.and(f.city.isDifferentFrom(firstCities[index]));
                                }
                                return r;

                            }, undefined);
                            this.cityStats.moreStats.push(x);
                            lastFs.value = x.value;
                            this.cityStats.stats.push(lastFs);
                        }

                    }
                    if (i > 8) {
                        lastFs.value += fs.value;
                        this.cityStats.moreStats.push(fs);
                    }



                });
                this.cityStats.moreStats.sort((a, b) => a.name.localeCompare(b.name));
                for (const g of st.groups) {
                    this.groupsReady.stats.push(new FaimilyStatistics(g.name, f => f.readyFilter(undefined, g.name), undefined, g.totalReady));
                    this.groupsTotals.stats.push(new FaimilyStatistics(g.name, f => f.deliverStatus.isDifferentFrom(DeliveryStatus.RemovedFromList).and(f.groups.isContains(g.name)), undefined, g.total));
                }

                this.updateChart();
            }));
    }
    showTotalBoxes() {
        if (this.currentTabStats == this.basketStats) {
            let r = 'סה"כ ' + BasketType.boxes1Name + ': ' + this.totalBoxes1;
            if (this.blockedBoxes1) {
                r += ', סה"כ ' + BasketType.boxes1Name + ' חסומים: ' + this.blockedBoxes1;
            }
            if (this.totalBoxes2)
                r += ', סה"כ ' + BasketType.boxes2Name + ': ' + this.totalBoxes2;
            if (this.blockedBoxes2) {
                r += ', סה"כ ' + BasketType.boxes2Name + ' חסומים: ' + this.blockedBoxes2;
            }
            return r;
        }
        return undefined;
    }
    @ViewChild('myTab', { static: false }) myTab: MatTabGroup;
    @ViewChild('familyInfo', { static: true }) familyInfo: UpdateFamilyComponent;
    ngOnInit() {

        this.refreshStats();
        let cols = this.families.columns;
        let firstColumns = [
            cols.items[0],
            cols.items[1],
            cols.items[2],
            cols.items[3]
        ];
        if (this.problemOnly) {
            firstColumns = [
                this.familyNameColumn,
                this.addressByGoogleColumn,
                this.familyAddressColumn,
                this.addressCommentColumn
            ];
        }
        cols.items.sort((a, b) => a.caption > b.caption ? 1 : a.caption < b.caption ? -1 : 0);

        for (let index = 0; index < firstColumns.length; index++) {
            const item = firstColumns[index];
            let origIndex = cols.items.indexOf(item);
            cols.moveCol(item, -origIndex + index);
        }

        //  debugger;


    }
    statTotal(t: statsOnTab) {
        let r = 0;
        t.stats.forEach(x => r += +x.value);
        return r;
    }

    [reuseComponentOnNavigationAndCallMeWhenNavigatingToIt]() {
        this.suspend = false;

        this.refresh();
    }
    suspend = false;
    [leaveComponent]() {

        this.suspend = true;
    }
    refresh() {
        this.refreshFamilyGrid();
        this.refreshStats();
    }

    static route: Route = {
        path: 'families',
        component: FamiliesComponent,
        data: { name: 'משפחות' }, canActivate: [AdminGuard]
    }
    previewFamily() {
        let x = new MatDialogConfig();
        x.data = {
            f: this.families.currentRow
        } as PreviewFamilyInfo;
        x.minWidth = 350;
        this.matDialog.open(PreviewFamilyComponent, x);
    }
}

interface statsOnTab {
    name: string,
    stats: FaimilyStatistics[],
    moreStats: FaimilyStatistics[],
    rule: (f: Families) => FilterBase,
    fourthColumn: () => ColumnSetting<any>
}