import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { WizardComponent } from './wizard.component';
import { RouterModule, Routes } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { SettingComponent } from '../components/setting/setting.component';

const routes: Routes = [
  {
    path: '',
    component: WizardComponent,
  },
];

@NgModule({
  declarations: [WizardComponent, SettingComponent],
  imports: [
    RouterModule.forChild(routes), CommonModule, FormsModule, MatButtonModule
  ]
})
export class WizardModule {
}